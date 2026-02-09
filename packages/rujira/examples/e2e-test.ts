/**
 * E2E Test: Complete Rujira Flow
 *
 * Goal: Test the complete flow:
 * 1. Deposit ETH into Rujira (THORChain)
 * 2. Trade on FIN (ETH → USDC)
 * 3. Withdraw USDC back to ETH Mainnet
 *
 * Run with:
 *   source /home/paaao/Giga/.secrets/vultisig-credentials.env
 *   VULT_FILE=/home/paaao/Giga/.secrets/vultisig-backups/Ray-Test.vult npx tsx examples/e2e-test.ts
 */

import { RujiraClient, ASSETS, EASY_ROUTES } from '../src';
import { VultisigRujiraProvider } from '../src/signer';
import { Vultisig, MemoryStorage } from '@vultisig/sdk';
import * as fs from 'fs';

interface TestResult {
  step: string;
  status: 'success' | 'failed' | 'skipped';
  data?: Record<string, unknown>;
  error?: string;
}

async function main() {
  const results: TestResult[] = [];
  const password = process.env.VAULT_PASSWORD;
  const vultFilePath = process.env.VULT_FILE;

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║            RUJIRA SDK E2E INTEGRATION TEST                       ║');
  console.log('║            Date: ' + new Date().toISOString().slice(0, 19) + '                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // ============================================================================
  // STEP 0: Setup - Initialize Vault and Client
  // ============================================================================
  console.log('🔧 STEP 0: Setup\n');

  if (!password) {
    console.log('❌ Missing VAULT_PASSWORD env var');
    results.push({ step: 'Setup', status: 'failed', error: 'Missing VAULT_PASSWORD' });
    outputResults(results);
    return;
  }

  if (!vultFilePath) {
    console.log('❌ Missing VULT_FILE env var');
    results.push({ step: 'Setup', status: 'failed', error: 'Missing VULT_FILE' });
    outputResults(results);
    return;
  }

  let client: RujiraClient;
  let thorAddress: string;
  let ethAddress: string;

  try {
    const vultFileContent = fs.readFileSync(vultFilePath, 'utf8');

    const sdk = new Vultisig({
      storage: new MemoryStorage(),
      onPasswordRequired: async () => password,
    });
    await sdk.initialize();

    const vault = await sdk.importVault(vultFileContent, password);
    console.log(`✅ Vault loaded: ${vault.name}`);

    // Create signer first to get addresses
    const signer = new VultisigRujiraProvider(vault);
    
    // Get THORChain address from signer
    thorAddress = await signer.getAddress();
    
    // Get ETH address from vault
    // Note: some vault exports may not include a "coins" entry with chain === "Ethereum".
    // Prefer SDK helpers when available, then fall back to coins array.
    const coins = (vault as any).coins || [];

    const addrFn = (vault as any).address || (vault as any).getAddress;
    const addrMaybe = typeof addrFn === 'function'
      ? (addrFn.call(vault, 'Ethereum') || addrFn.call(vault, 'ETH'))
      : '';
    const addrFromVault = addrMaybe instanceof Promise ? await addrMaybe : addrMaybe;

    const ethCoin = coins.find((c: any) =>
      (c?.chain || '').toLowerCase() === 'ethereum' ||
      (c?.ticker || '').toLowerCase() === 'eth'
    );

    ethAddress = (addrFromVault || ethCoin?.address || '').toString();

    console.log(`   THORChain: ${thorAddress}`);
    console.log(`   Ethereum:  ${ethAddress || '(not available)'}`);
    if (!ethAddress) {
      console.log('   Debug: vault.coins =', coins);
    }

    // Use the signer we already created
    client = new RujiraClient({
      network: 'mainnet',
      signer,
      apiKey: process.env.RUJIRA_API_KEY,
      debug: true,
    });

    await client.connect();
    console.log(`✅ RujiraClient connected\n`);

    results.push({
      step: 'Setup',
      status: 'success',
      data: { thorAddress, ethAddress, vaultName: vault.name },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Setup failed: ${msg}\n`);
    results.push({ step: 'Setup', status: 'failed', error: msg });
    outputResults(results);
    return;
  }

  // ============================================================================
  // STEP 1: Check Balances
  // ============================================================================
  console.log('💰 STEP 1: Check Balances\n');

  try {
    const balances = await client.deposit.getBalances(thorAddress);
    console.log('Secured balances on THORChain:');
    for (const bal of balances) {
      console.log(`   ${bal.symbol}: ${bal.formatted} (${bal.denom})`);
    }

    // Check if we have any ETH secured
    const ethBalance = balances.find(b => b.symbol === 'ETH');
    const usdcBalance = balances.find(b => b.symbol === 'USDC');

    results.push({
      step: 'Check Balances',
      status: 'success',
      data: {
        totalAssets: balances.length,
        ethSecured: ethBalance?.formatted || '0',
        usdcSecured: usdcBalance?.formatted || '0',
      },
    });

    console.log(`\n✅ Found ${balances.length} secured assets\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Balance check failed: ${msg}\n`);
    results.push({ step: 'Check Balances', status: 'failed', error: msg });
  }

  // ============================================================================
  // STEP 2: Prepare ETH Deposit (L1 → THORChain)
  // ============================================================================
  console.log('📥 STEP 2: Prepare ETH Deposit\n');

  try {
    // Small test amount: 0.001 ETH = 1000000000000000 wei
    const depositAmount = '1000000000000000'; // 0.001 ETH

    const deposit = await client.deposit.prepare({
      fromAsset: 'ETH.ETH',
      amount: depositAmount,
      thorAddress,
    });

    console.log('Deposit prepared:');
    console.log(`   Chain: ${deposit.chain}`);
    console.log(`   Inbound Address: ${deposit.inboundAddress}`);
    console.log(`   Memo: ${deposit.memo}`);
    console.log(`   Amount: ${deposit.amount} wei (0.001 ETH)`);
    console.log(`   Resulting Denom: ${deposit.resultingDenom}`);
    console.log(`   Min Amount: ${deposit.minimumAmount}`);
    console.log(`   Est. Time: ${deposit.estimatedTimeMinutes} min`);
    if (deposit.warning) {
      console.log(`   ⚠️  Warning: ${deposit.warning}`);
    }

    results.push({
      step: 'Prepare ETH Deposit',
      status: 'success',
      data: {
        inboundAddress: deposit.inboundAddress,
        memo: deposit.memo,
        amount: '0.001 ETH',
        estimatedTime: `${deposit.estimatedTimeMinutes} min`,
      },
    });

    console.log(`\n✅ Deposit prepared (NOT EXECUTED - requires L1 tx)\n`);
    console.log('   To execute: Send 0.001 ETH to the inbound address with the memo above.\n');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Deposit preparation failed: ${msg}\n`);
    results.push({ step: 'Prepare ETH Deposit', status: 'failed', error: msg });
  }

  // ============================================================================
  // STEP 3: Get Swap Quote (ETH → USDC on FIN)
  // ============================================================================
  console.log('💱 STEP 3: Get Swap Quote (ETH → USDC)\n');

  try {
    const quote = await client.swap.getQuote({
      fromAsset: ASSETS.ETH,
      toAsset: ASSETS.USDC,
      amount: '10000000', // 0.0001 ETH in 8 decimals (THORChain format)
      slippageBps: 100,
    });

    console.log('Swap Quote:');
    console.log(`   From: ${ASSETS.ETH}`);
    console.log(`   To: ${ASSETS.USDC}`);
    console.log(`   Input: 0.0001 ETH`);
    console.log(`   Expected Output: ${quote.expectedOutput} USDC`);
    console.log(`   Minimum Output: ${quote.minimumOutput} USDC`);
    console.log(`   Price Impact: ${quote.priceImpact}%`);
    console.log(`   Expires: ${new Date(quote.expiresAt).toLocaleString()}`);

    results.push({
      step: 'Get Swap Quote',
      status: 'success',
      data: {
        expectedOutput: quote.expectedOutput,
        minimumOutput: quote.minimumOutput,
        priceImpact: quote.priceImpact,
        route: 'ETH → USDC via FIN',
      },
    });

    console.log(`\n✅ Quote received\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Quote failed: ${msg}\n`);
    results.push({ step: 'Get Swap Quote', status: 'failed', error: msg });
  }

  // ============================================================================
  // STEP 4: Check Available Easy Routes
  // ============================================================================
  console.log('🗺️  STEP 4: List Available Routes\n');

  try {
    const routes = Object.keys(EASY_ROUTES);
    console.log(`Available easy routes (${routes.length}):`);
    for (const name of routes.slice(0, 10)) {
      const route = EASY_ROUTES[name as keyof typeof EASY_ROUTES];
      console.log(`   ${name}: ${route.from} → ${route.to}`);
    }
    if (routes.length > 10) {
      console.log(`   ... and ${routes.length - 10} more`);
    }

    results.push({
      step: 'List Routes',
      status: 'success',
      data: { totalRoutes: routes.length },
    });

    console.log(`\n✅ ${routes.length} routes available\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Route listing failed: ${msg}\n`);
    results.push({ step: 'List Routes', status: 'failed', error: msg });
  }

  // ============================================================================
  // STEP 5: Prepare Withdrawal (USDC → ETH L1)
  // ============================================================================
  console.log('📤 STEP 5: Prepare USDC Withdrawal\n');

  try {
    const withdraw = await client.withdraw.prepare({
      asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: '100000', // 0.1 USDC (6 decimals)
      l1Address: ethAddress,
    });

    console.log('Withdrawal prepared:');
    console.log(`   Chain: ${withdraw.chain}`);
    console.log(`   Asset: ${withdraw.asset}`);
    console.log(`   Denom: ${withdraw.denom}`);
    console.log(`   Amount: ${withdraw.amount} (0.1 USDC)`);
    console.log(`   Destination: ${withdraw.destination}`);
    console.log(`   Memo: ${withdraw.memo}`);
    console.log(`   Est. Fee: ${withdraw.estimatedFee}`);
    console.log(`   Est. Time: ${withdraw.estimatedTimeMinutes} min`);

    results.push({
      step: 'Prepare Withdrawal',
      status: 'success',
      data: {
        memo: withdraw.memo,
        destination: withdraw.destination,
        estimatedTime: `${withdraw.estimatedTimeMinutes} min`,
      },
    });

    console.log(`\n✅ Withdrawal prepared (NOT EXECUTED - requires secured balance)\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Withdrawal preparation failed: ${msg}\n`);
    results.push({ step: 'Prepare Withdrawal', status: 'failed', error: msg });
  }

  // ============================================================================
  // STEP 6: Check Orderbook
  // ============================================================================
  console.log('📊 STEP 6: Check Orderbook (ETH/USDC)\n');

  try {
    const book = await client.orderbook.getBook(ASSETS.ETH, ASSETS.USDC);
    
    console.log('Orderbook snapshot:');
    console.log(`   Spread: ${book.spread}%`);
    console.log(`   Bids: ${book.bids.length}`);
    console.log(`   Asks: ${book.asks.length}`);
    if (book.bids[0]) {
      console.log(`   Best Bid: ${book.bids[0].price}`);
    }
    if (book.asks[0]) {
      console.log(`   Best Ask: ${book.asks[0].price}`);
    }

    results.push({
      step: 'Check Orderbook',
      status: 'success',
      data: {
        spread: book.spread,
        bidCount: book.bids.length,
        askCount: book.asks.length,
      },
    });

    console.log(`\n✅ Orderbook data retrieved\n`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`❌ Orderbook check failed: ${msg}\n`);
    results.push({ step: 'Check Orderbook', status: 'failed', error: msg });
  }

  // ============================================================================
  // Output Results
  // ============================================================================
  outputResults(results);
}

function outputResults(results: TestResult[]) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                         TEST SUMMARY                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const passed = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'failed' ? '❌' : '⏭️';
    console.log(`${icon} ${r.step}: ${r.status.toUpperCase()}`);
    if (r.error) {
      console.log(`   Error: ${r.error}`);
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${skipped} skipped\n`);

  // Output JSON for parsing
  console.log('--- JSON OUTPUT ---');
  console.log(JSON.stringify({ results, summary: { passed, failed, skipped } }, null, 2));
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
