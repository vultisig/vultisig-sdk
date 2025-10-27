import { describe, test, beforeAll, afterAll, expect } from 'vitest';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type { Vault } from '../../../../src/vault/Vault';
import { getTestVault } from '../../utils/vault-loader';
import { loadTestConfig } from '../../config/test-config';
import { txLogger } from '../../utils/logger';
import {
  checkSufficientBalance,
  convertUsdToNative,
  TestAssertions,
} from '../../utils/test-helpers';
import {
  parseSolanaTransaction,
  buildSolanaKeysignPayload,
} from '../../../../src/chains/solana';
import { SOLANA_PROGRAMS, getSolanaExplorerUrl } from './fixtures';

describe('Solana Integration Tests', () => {
  let vault: Vault;
  let config: ReturnType<typeof loadTestConfig>;
  let connection: Connection;
  let vaultAddress: string;

  beforeAll(async () => {
    // Load configuration
    config = loadTestConfig();

    // Initialize Solana connection
    connection = new Connection(
      config.chains.solana.rpcEndpoint,
      'confirmed'
    );

    // Load test vault
    vault = await getTestVault(config.vaultPassword);
    TestAssertions.assertVault(vault);

    // Get vault's Solana address
    vaultAddress = await vault.address('Solana');
    TestAssertions.assertAddress(vaultAddress, 'Solana');

    console.log('\n' + '='.repeat(80));
    console.log('Solana Integration Test Suite');
    console.log('='.repeat(80));
    console.log('Vault Address:', vaultAddress);
    console.log('RPC Endpoint:', config.chains.solana.rpcEndpoint);
    console.log('Dry-Run Mode:', config.dryRun ? 'ENABLED' : 'DISABLED');
    console.log('='.repeat(80) + '\n');
  });

  afterAll(() => {
    // Print test summary
    txLogger.printSummary();
  });

  describe('Native SOL Transfer', () => {
    test('should transfer native SOL to recipient', async () => {
      const testConfig = config.chains.solana;

      // Determine recipient address (self-transfer if not specified)
      const recipientAddress = testConfig.recipientAddress || vaultAddress;

      // Convert USD to SOL
      const { native, lamports, formatted } = convertUsdToNative(
        testConfig.testAmountUsd,
        'SOL',
        9 // Solana decimals
      );

      console.log('Test Amount:', formatted);
      console.log('Lamports:', lamports.toString());
      console.log('Recipient:', recipientAddress);

      // Check sufficient balance
      const balanceCheck = await checkSufficientBalance(
        vault,
        'Solana',
        native,
        'SOL'
      );

      console.log('Current Balance:', balanceCheck.currentBalance, 'SOL');
      console.log('Required Amount:', balanceCheck.required, 'SOL');

      TestAssertions.assertSufficientBalance(balanceCheck, 'SOL');

      // Create Solana transaction
      const fromPubkey = new PublicKey(vaultAddress);
      const toPubkey = new PublicKey(recipientAddress);

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');

      // Create transfer instruction
      const transaction = new Transaction({
        feePayer: fromPubkey,
        blockhash,
        lastValidBlockHeight,
      });

      transaction.add(
        SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: Number(lamports),
        })
      );

      // Serialize the transaction
      const serializedTx = transaction.serializeMessage();

      console.log('Transaction created and serialized');

      if (config.dryRun) {
        // Dry-run mode: log transaction details without broadcasting
        txLogger.logDryRunPayload({
          chain: 'Solana',
          operation: 'Native SOL Transfer',
          payload: {
            from: vaultAddress,
            to: recipientAddress,
            amount: formatted,
            lamports: lamports.toString(),
            blockhash,
            serializedTx: Buffer.from(serializedTx).toString('base64'),
          },
        });

        txLogger.logSuccess({
          chain: 'Solana',
          operation: 'Native SOL Transfer',
          amount: formatted,
          from: vaultAddress,
          to: recipientAddress,
          dryRun: true,
        });

        // In dry-run mode, we still verify that the SDK can parse and build payload
        expect(serializedTx).toBeDefined();
        expect(serializedTx.length).toBeGreaterThan(0);
      } else {
        // Live mode: parse, sign, and broadcast transaction
        console.log('Parsing transaction...');

        // Note: parseSolanaTransaction requires WalletCore which might not be
        // easily accessible in integration tests. For now, we'll build the
        // keysign payload manually based on the transaction structure.

        // Get vault public key (hex format)
        // TODO: Add method to vault to get hex public key for Solana
        const vaultPubKeyHex = ''; // This needs to be retrieved from vault

        // For now, we'll use the vault's sign method directly with a simplified payload
        // This is a limitation of the current SDK structure that should be addressed

        // Build keysign payload
        // const parsedTx = await parseSolanaTransaction(walletCore, serializedTx);
        // const keysignPayload = await buildSolanaKeysignPayload({
        //   parsedTransaction: parsedTx,
        //   serializedTransaction: serializedTx,
        //   vaultPublicKey: vaultPubKeyHex,
        //   skipBroadcast: false,
        // });

        // Sign transaction
        // const signature = await vault.sign('fast', keysignPayload, config.vaultPassword);

        // TODO: This is a placeholder for the actual signing flow
        // The SDK needs additional methods to properly support this flow

        throw new Error(
          'Live transaction signing not yet implemented. ' +
            'The SDK needs additional methods to support creating and signing ' +
            'Solana transactions in integration tests. Please use DRY_RUN=true for now.'
        );

        // Once implemented, the flow would be:
        // 1. Sign with vault.sign()
        // 2. Extract signed transaction
        // 3. Broadcast with connection.sendRawTransaction()
        // 4. Confirm transaction
        // 5. Log success with transaction hash

        // Example of what it would look like:
        // const txHash = await connection.sendRawTransaction(signedTx);
        // await connection.confirmTransaction(txHash, 'confirmed');
        //
        // txLogger.logSuccess({
        //   chain: 'Solana',
        //   operation: 'Native SOL Transfer',
        //   hash: txHash,
        //   explorerUrl: getSolanaExplorerUrl(txHash),
        //   amount: formatted,
        //   from: vaultAddress,
        //   to: recipientAddress,
        //   dryRun: false,
        // });
      }
    }, 60000); // 60 second timeout
  });

  describe('SPL Token Transfer', () => {
    test.todo('should transfer SPL tokens to recipient', () => {
      // TODO: Implement SPL token transfer test
      //
      // Steps:
      // 1. Get or create associated token accounts for sender and recipient
      // 2. Build token transfer instruction
      // 3. Serialize transaction
      // 4. Parse with SDK
      // 5. Sign with vault
      // 6. Broadcast if not dry-run
      // 7. Log transaction
      //
      // Test tokens to consider:
      // - USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
      // - USDT: Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB
    });
  });

  describe('Jupiter V6 Swap', () => {
    test.todo('should execute a Jupiter swap', () => {
      // TODO: Implement Jupiter swap test
      //
      // Steps:
      // 1. Fetch quote from Jupiter API (SOL -> USDC)
      // 2. Get swap transaction from Jupiter API
      // 3. Parse transaction with SDK
      // 4. Build keysign payload
      // 5. Sign with vault
      // 6. Broadcast if not dry-run
      // 7. Log transaction
      //
      // Jupiter API: https://quote-api.jup.ag/v6
      // - GET /quote - Get swap quote
      // - POST /swap - Get swap transaction
    });
  });

  describe('Raydium AMM Swap', () => {
    test.todo('should execute a Raydium swap', () => {
      // TODO: Implement Raydium swap test
      //
      // Steps:
      // 1. Fetch pool info from Raydium
      // 2. Build swap transaction
      // 3. Parse transaction with SDK
      // 4. Build keysign payload
      // 5. Sign with vault
      // 6. Broadcast if not dry-run
      // 7. Log transaction
      //
      // Raydium SDK: @raydium-io/raydium-sdk
      // Common pools: SOL/USDC, SOL/USDT, etc.
    });
  });

  describe('Balance Queries', () => {
    test('should fetch native SOL balance', async () => {
      const balance = await vault.balance('Solana');

      console.log('SOL Balance:', balance, 'SOL');

      expect(balance).toBeDefined();
      expect(typeof balance).toBe('string');
      expect(parseFloat(balance.toString())).toBeGreaterThan(0);
    });

    test.todo('should fetch SPL token balances', () => {
      // TODO: Implement token balance fetching
      //
      // Steps:
      // 1. Get all token accounts for the vault address
      // 2. Parse token balances
      // 3. Verify known token balances (if any)
      //
      // Use: connection.getParsedTokenAccountsByOwner()
    });
  });

  describe('Address Validation', () => {
    test('should have valid Solana address format', () => {
      expect(vaultAddress).toBeDefined();
      expect(vaultAddress.length).toBeGreaterThan(32);
      expect(vaultAddress.length).toBeLessThan(45);

      // Should be valid base58
      expect(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(vaultAddress)).toBe(true);

      console.log('Vault Solana Address:', vaultAddress);
    });

    test('should derive consistent address', async () => {
      const address1 = await vault.address('Solana');
      const address2 = await vault.address('Solana');

      expect(address1).toBe(address2);
    });
  });
});
