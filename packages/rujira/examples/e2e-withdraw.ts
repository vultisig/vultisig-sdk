/**
 * E2E Test: Withdrawal Execute
 * 
 * Test the withdraw.execute() function with a real withdrawal.
 * Withdraws 0.1 USDC from Rujira to ETH mainnet.
 * 
 * Run with:
 *   source /home/paaao/Giga/.secrets/vultisig-credentials.env
 *   VULT_FILE=/home/paaao/Giga/.secrets/vultisig-backups/Ray-Test.vult npx tsx examples/e2e-withdraw.ts
 */

import { RujiraClient } from '../src';
import { VultisigRujiraProvider } from '../src/signer';
import { Vultisig, MemoryStorage } from '@vultisig/sdk';
import * as fs from 'fs';

async function main() {
  const password = process.env.VAULT_PASSWORD;
  const vultFilePath = process.env.VULT_FILE;

  if (!password) throw new Error('Missing VAULT_PASSWORD env var');
  if (!vultFilePath) throw new Error('Missing VULT_FILE env var');

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║            RUJIRA WITHDRAWAL E2E TEST                            ║');
  console.log('║            Date: ' + new Date().toISOString().slice(0, 19) + '                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Setup
  console.log('🔧 Setting up vault and client...\n');
  const vultFileContent = fs.readFileSync(vultFilePath, 'utf8');
  const sdk = new Vultisig({
    storage: new MemoryStorage(),
    onPasswordRequired: async () => password,
  });
  await sdk.initialize();

  const vault = await sdk.importVault(vultFileContent, password);
  console.log(`✅ Vault: ${vault.name}`);

  const signer = new VultisigRujiraProvider(vault);
  const thorAddress = await signer.getAddress();
  
  // Get ETH address from vault's coin data
  const coins = (vault as any).coins || [];
  const ethCoin = coins.find((c: { chain: string }) => c.chain === 'Ethereum');
  const ethAddress = ethCoin?.address || process.env.VULTISIG_RAYTEST_ETH || '';

  console.log(`   THORChain: ${thorAddress}`);
  console.log(`   Ethereum:  ${ethAddress}`);

  const client = new RujiraClient({
    network: 'mainnet',
    signer,
    apiKey: process.env.RUJIRA_API_KEY,
    debug: true,
  });

  await client.connect();
  console.log(`✅ Client connected\n`);

  // Step 1: Check current balances
  console.log('📊 Step 1: Checking secured balances...\n');
  const balances = await client.deposit.getBalances(thorAddress);
  
  console.log('Current secured balances:');
  for (const bal of balances) {
    console.log(`   ${bal.symbol}: ${bal.formatted}`);
  }

  const usdcBalance = balances.find(b => b.symbol === 'USDC');
  const usdcAmount = usdcBalance ? parseFloat(usdcBalance.formatted) : 0;
  
  if (!usdcBalance || usdcAmount < 0.1) {
    console.log(`\n⚠️  Insufficient secured USDC. Have: ${usdcAmount}, need: 0.1`);
    console.log('   Cannot proceed with withdrawal test.\n');
    
    // Show what we'd do if we had balance
    console.log('📝 Would have prepared this withdrawal:');
    try {
      const prepared = await client.withdraw.prepare({
        asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        amount: '100000', // 0.1 USDC (6 decimals)
        l1Address: ethAddress,
      });
      console.log(`   Asset: ${prepared.asset}`);
      console.log(`   Denom: ${prepared.denom}`);
      console.log(`   Amount: ${prepared.amount} (0.1 USDC)`);
      console.log(`   Destination: ${prepared.destination}`);
      console.log(`   Memo: ${prepared.memo}`);
      console.log(`   Est. Fee: ${prepared.estimatedFee}`);
      console.log(`   Est. Time: ${prepared.estimatedTimeMinutes} min`);
    } catch (prepError) {
      console.log(`   Prepare error: ${prepError instanceof Error ? prepError.message : String(prepError)}`);
    }
    return;
  }

  console.log(`\n✅ Have ${usdcAmount} secured USDC - proceeding with withdrawal test\n`);

  // Step 2: Prepare withdrawal
  console.log('📤 Step 2: Preparing withdrawal...\n');
  
  // Withdraw 0.2 USDC (8 decimals on THORChain = 20000000)
  // Note: THORChain uses 8 decimals for ALL assets, including USDC
  // Outbound fee for ETH is ~9000 units, so we need more than that
  const withdrawAmount = '20000000'; // 0.2 USDC
  
  try {
    const prepared = await client.withdraw.prepare({
      asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      amount: withdrawAmount,
      l1Address: ethAddress,
    });

    console.log('Withdrawal prepared:');
    console.log(`   Asset: ${prepared.asset}`);
    console.log(`   Denom: ${prepared.denom}`);
    console.log(`   Amount: ${prepared.amount}`);
    console.log(`   Destination: ${prepared.destination}`);
    console.log(`   Memo: ${prepared.memo}`);
    console.log(`   Est. Fee: ${prepared.estimatedFee}`);
    console.log(`   Est. Time: ${prepared.estimatedTimeMinutes} min`);
    console.log(`   Funds: ${JSON.stringify(prepared.funds)}\n`);

    // Step 3: Execute withdrawal
    console.log('🚀 Step 3: Executing withdrawal...\n');
    
    const result = await client.withdraw.execute(prepared);

    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                    WITHDRAWAL SUCCESSFUL! 🎉                     ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');
    console.log(`   TX Hash: ${result.txHash}`);
    console.log(`   Asset: ${result.asset}`);
    console.log(`   Amount: ${result.amount}`);
    console.log(`   Destination: ${result.destination}`);
    console.log(`   Status: ${result.status}`);
    console.log(`\n   View on THORScan: https://thorchain.net/tx/${result.txHash}\n`);

    return result.txHash;

  } catch (error) {
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║                    WITHDRAWAL FAILED ❌                          ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');
    
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`Error: ${errorMsg}\n`);
    
    if (error instanceof Error && error.stack) {
      console.log('Stack trace:');
      console.log(error.stack);
    }

    // Check if error has additional details
    if (error && typeof error === 'object' && 'details' in error) {
      console.log('\nError details:');
      console.log(JSON.stringify((error as any).details, null, 2));
    }

    throw error;
  }
}

main()
  .then((txHash) => {
    if (txHash) {
      console.log(`\n✅ Test completed successfully. TX: ${txHash}`);
      process.exit(0);
    } else {
      console.log('\n⚠️  Test completed without executing withdrawal (insufficient balance).');
      process.exit(0);
    }
  })
  .catch((e) => {
    console.error('\n💀 Fatal error:', e.message);
    process.exit(1);
  });
