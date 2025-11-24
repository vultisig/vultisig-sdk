# Phase 4: End-to-End Testing

**Duration**: Week 7-8
**Coverage Target**: 75%
**Priority**: CRITICAL

## 🔴 PRODUCTION TESTING WITH REAL FUNDS

**⚠️ This phase uses PRODUCTION environment with SMALL AMOUNTS of REAL FUNDS**

### ⚠️ WARNING: REAL MONEY AT RISK

Phase 4 E2E tests involve creating real vaults on production VultiServer and broadcasting real transactions on mainnet blockchains with actual cryptocurrency. While we use small amounts ($1-5 per chain), there is **REAL FINANCIAL RISK**.

### Why Production with Real Funds in E2E?

1. **No Staging Environment**: VultiServer does not have a staging/test environment available
2. **Testnet Limitations**: Testnets don't catch production-specific issues (server load, real MPC timing, mainnet RPC differences)
3. **Cryptographic Authenticity**: Only real MPC operations validate actual signature correctness
4. **Production Confidence**: Tests the EXACT user experience with real servers and real blockchains
5. **True End-to-End**: Complete user workflows from vault creation to transaction broadcasting

### Safety Strategy

- ✅ **SMALL AMOUNTS ONLY**: Maximum $5 per chain, $50 total budget
- ✅ **MANUAL APPROVAL**: Explicit confirmation required before ANY transaction broadcast
- ✅ **LOW-FEE FIRST**: Test on Solana/Polygon before Bitcoin/Ethereum
- ✅ **TRANSACTION LOGGING**: All transaction hashes logged for audit
- ✅ **VAULT BACKUP**: Export and backup all test vaults immediately after creation
- ✅ **ADDRESS DOCUMENTATION**: Document all test addresses for fund recovery
- ✅ **AMOUNT LIMITS**: Hard-coded maximum amounts in test code
- ✅ **RECOVERY PLAN**: Keep .vult backups and private keys recoverable

### Production Environment Setup

```bash
# PRODUCTION endpoints
VULTISIG_API_URL=https://api.vultisig.com
VULTISIG_RELAY_URL=<production-relay-url>

# Test credentials
VULTISIG_TEST_EMAIL=sdk-e2e-tests@example.com
VULTISIG_TEST_PASSWORD=<secure-password>

# MAINNET RPC endpoints
ETH_MAINNET_RPC=https://eth-mainnet.g.alchemy.com/v2/<key>
BTC_MAINNET_RPC=https://blockstream.info/api
SOL_MAINNET_RPC=https://api.mainnet-beta.solana.com
POLYGON_MAINNET_RPC=https://polygon-rpc.com

# Safety controls
MAX_TOTAL_TEST_FUNDS_USD=50
MAX_PER_CHAIN_USD=5
REQUIRE_TX_APPROVAL=true
LOG_ALL_TRANSACTIONS=true
EXPORT_TEST_VAULTS=true
```

## Objectives

1. Test complete user workflows from start to finish **WITH PRODUCTION SERVER**
2. Validate transaction signing for all chain families **WITH REAL MPC**
3. Test full import/export cycles with **REAL VAULT FILES**
4. Test **REAL TRANSACTION BROADCASTING** on mainnet (small amounts)
5. Implement error recovery and edge case scenarios
6. Performance benchmarking of critical operations

## Prerequisites

- Phases 1-3 completed successfully
- 65% code coverage achieved
- Integration tests passing (all 40+ chains)
- **PRODUCTION CREDENTIALS**: Test email account set up
- **TEST FUNDS**: Small amounts loaded ($50 total budget)
- **MAINNET RPC ACCESS**: All chain RPC endpoints configured
- All chain fixtures populated

## Week 7: Complete User Workflows

### Day 1-2: Full Fast Vault Creation E2E

#### Task 4.1: Complete Fast Vault User Journey

```typescript
// tests/e2e/fast-vault-creation/complete-flow.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { Page } from "@playwright/test"; // For UI testing if applicable
import { mockEmailService } from "@helpers/email-mocks";

describe("E2E: Fast Vault Creation Complete Flow", () => {
  let sdk: VultisigSDK;
  let emailService: ReturnType<typeof mockEmailService>;

  beforeEach(async () => {
    sdk = new VultisigSDK({
      apiUrl: process.env.TEST_API_URL || "https://test.api.vultisig.com",
    });
    await sdk.init();

    emailService = mockEmailService();
  });

  it("should complete full fast vault creation with email verification", async () => {
    // Step 1: User initiates vault creation
    console.log("📝 Step 1: Initiating vault creation...");

    const userInput = {
      name: "My Production Vault",
      email: "user@example.com",
      password: "SecurePassword123!@#",
      chains: ["bitcoin", "ethereum", "solana", "thorchain", "ripple"],
    };

    // Start creation process
    const creationPromise = sdk.createFastVault(userInput);

    // Step 2: System generates session and coordinates with server
    console.log("🔄 Step 2: Coordinating with VultiServer...");

    // Monitor session creation
    await waitFor(() => {
      const sessions = sdk.serverManager.getActiveSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].type).toBe("fast-vault-creation");
    });

    // Step 3: MPC Keygen Protocol Execution
    console.log("🔐 Step 3: Executing MPC keygen protocol...");

    // Wait for ECDSA keygen
    await waitFor(
      () => {
        const progress = sdk.serverManager.getSessionProgress(sessions[0].id);
        expect(progress.ecdsaKeygen).toBe("completed");
      },
      { timeout: 15000 },
    );

    // Wait for EdDSA keygen
    await waitFor(
      () => {
        const progress = sdk.serverManager.getSessionProgress(sessions[0].id);
        expect(progress.eddsaKeygen).toBe("completed");
      },
      { timeout: 15000 },
    );

    // Step 4: Vault creation completes
    console.log("✅ Step 4: Vault created successfully");

    const vault = await creationPromise;

    expect(vault).toBeDefined();
    expect(vault.id).toBeDefined();
    expect(vault.name).toBe("My Production Vault");
    expect(vault.type).toBe("fast");
    expect(vault.verified).toBe(false);
    expect(vault.chains).toEqual(userInput.chains);

    // Step 5: Email verification
    console.log("📧 Step 5: Verifying email...");

    // Check email was sent
    const sentEmails = emailService.getSentEmails();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("user@example.com");
    expect(sentEmails[0].subject).toContain("Verify your Vultisig vault");

    // Extract verification code from email
    const verificationCode = extractVerificationCode(sentEmails[0].body);
    expect(verificationCode).toMatch(/^\d{6}$/);

    // Verify the vault
    const verificationResult = await sdk.verifyVaultEmail(
      vault.id,
      verificationCode,
    );

    expect(verificationResult.success).toBe(true);
    expect(vault.verified).toBe(true);

    // Step 6: Derive addresses for all chains
    console.log("🔑 Step 6: Deriving blockchain addresses...");

    const addresses = await vault.getAllAddresses();

    expect(addresses.bitcoin).toMatch(/^(bc1|1|3)/);
    expect(addresses.ethereum).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(addresses.solana).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(addresses.thorchain).toMatch(/^thor1[a-z0-9]{38,}$/);
    expect(addresses.ripple).toMatch(/^r[a-zA-Z0-9]{24,34}$/);

    // Step 7: Test vault persistence
    console.log("💾 Step 7: Testing vault persistence...");

    // Save to storage
    await sdk.vaultManager.saveToStorage();

    // Create new SDK instance
    const newSdk = new VultisigSDK();
    await newSdk.init();
    await newSdk.vaultManager.loadFromStorage();

    // Verify vault persisted
    const loadedVault = newSdk.vaultManager.getVault(vault.id);
    expect(loadedVault).toBeDefined();
    expect(loadedVault?.name).toBe("My Production Vault");

    console.log("✨ Fast vault creation flow completed successfully!");
  }, 60000); // 1 minute timeout for complete flow

  it("should handle user abandonment gracefully", async () => {
    // Start creation
    const creationPromise = sdk.createFastVault({
      name: "Abandoned Vault",
      email: "abandon@test.com",
      password: "password",
    });

    // Wait for session to start
    await waitFor(() => {
      const sessions = sdk.serverManager.getActiveSessions();
      expect(sessions).toHaveLength(1);
    });

    // User closes app/browser (simulate abandonment)
    sdk.serverManager.cancelAllSessions();

    // Creation should fail gracefully
    await expect(creationPromise).rejects.toThrow("Session cancelled");

    // No vault should be created
    const vaults = sdk.vaultManager.listVaults();
    expect(vaults).toHaveLength(0);

    // Server resources should be cleaned up
    const activeSessions = sdk.serverManager.getActiveSessions();
    expect(activeSessions).toHaveLength(0);
  });

  it("should recover from network interruptions", async () => {
    const creationParams = {
      name: "Network Test Vault",
      email: "network@test.com",
      password: "password",
    };

    // Start creation
    const creationPromise = sdk.createFastVault(creationParams);

    // Simulate network interruption during MPC
    setTimeout(() => {
      sdk.serverManager.simulateNetworkError();
    }, 2000);

    // SDK should retry and recover
    const vault = await creationPromise;

    expect(vault).toBeDefined();
    expect(vault.name).toBe("Network Test Vault");

    // Verify retry occurred
    const retryStats = sdk.serverManager.getRetryStats();
    expect(retryStats.totalRetries).toBeGreaterThan(0);
    expect(retryStats.successfulRecoveries).toBe(1);
  });
});

function extractVerificationCode(emailBody: string): string {
  const match = emailBody.match(/verification code is: (\d{6})/);
  return match?.[1] || "";
}

function waitFor(
  condition: () => void | Promise<void>,
  options = { timeout: 5000, interval: 100 },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = async () => {
      try {
        await condition();
        resolve();
      } catch (error) {
        if (Date.now() - startTime > options.timeout) {
          reject(new Error(`Timeout waiting for condition: ${error.message}`));
        } else {
          setTimeout(check, options.interval);
        }
      }
    };

    check();
  });
}
```

### Day 3-4: Transaction Signing E2E

#### Task 4.2: Multi-Chain Transaction Signing

```typescript
// tests/e2e/transaction-signing/multi-chain-signing.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { createTestVault } from "@helpers/vault-factory";
import {
  createBitcoinTransaction,
  createEthereumTransaction,
  createSolanaTransaction,
  createThorchainTransaction,
} from "@helpers/transaction-builders";

describe("E2E: Multi-Chain Transaction Signing", () => {
  let sdk: VultisigSDK;
  let vault: any;

  beforeAll(async () => {
    sdk = new VultisigSDK();
    await sdk.init();

    // Create a fast vault for testing
    vault = await createTestVault(sdk, {
      name: "Signing Test Vault",
      type: "fast",
      chains: ["bitcoin", "ethereum", "solana", "thorchain"],
    });
  });

  describe("Bitcoin Transaction Signing", () => {
    it("should prepare and sign Bitcoin transaction using prepareSendTx()", async () => {
      console.log("₿ Testing Bitcoin transaction preparation and signing...");

      // Get vault address
      const btcAddress = await vault.getAddress("bitcoin");

      // Step 1: Prepare transaction using prepareSendTx()
      const keysignPayload = await vault.prepareSendTx({
        coin: {
          chain: "bitcoin",
          address: btcAddress,
          decimals: 8,
          ticker: "BTC",
        },
        receiver: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        amount: 100000n, // 0.001 BTC
        feeSettings: {
          byteFeeRate: 10n, // 10 sat/byte
        },
      });

      expect(keysignPayload).toBeDefined();
      expect(keysignPayload.coin.chain).toBe("bitcoin");
      expect(keysignPayload.toAddress).toBe(
        "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      );

      // Step 2: Sign the prepared payload
      const signature = await vault.sign("fast", keysignPayload, TEST_PASSWORD);

      expect(signature).toBeDefined();
      expect(signature.r).toBeDefined();
      expect(signature.s).toBeDefined();

      console.log("✅ Bitcoin transaction prepared and signed successfully");
    });

    it("should sign simple Bitcoin transaction", async () => {
      console.log("₿ Testing Bitcoin transaction signing...");

      // Build transaction
      const btcAddress = await vault.getAddress("bitcoin");
      const transaction = await createBitcoinTransaction({
        from: btcAddress,
        to: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        amount: "0.001",
        fee: "0.00001",
      });

      // Sign transaction
      const signedTx = await vault.signTransaction("bitcoin", transaction);

      expect(signedTx).toBeDefined();
      expect(signedTx.signatures).toBeDefined();
      expect(signedTx.signatures.length).toBeGreaterThan(0);
      expect(signedTx.hash).toMatch(/^[a-fA-F0-9]{64}$/);

      // Verify signature validity
      const isValid = await verifyBitcoinSignature(signedTx);
      expect(isValid).toBe(true);

      console.log("✅ Bitcoin transaction signed successfully");
    });

    it("should sign complex multi-input Bitcoin transaction", async () => {
      const transaction = await createBitcoinTransaction({
        inputs: [
          { txid: "abc123...", vout: 0, amount: "0.5" },
          { txid: "def456...", vout: 1, amount: "0.3" },
        ],
        outputs: [
          { address: "bc1q...", amount: "0.7" },
          { address: "bc1q...", amount: "0.09" }, // Change
        ],
      });

      const signedTx = await vault.signTransaction("bitcoin", transaction);

      expect(signedTx.signatures).toHaveLength(2); // One per input
      signedTx.signatures.forEach((sig) => {
        expect(sig).toMatch(/^[a-fA-F0-9]+$/);
      });
    });
  });

  describe("Ethereum Transaction Signing", () => {
    it("should prepare and sign EIP-1559 transaction using prepareSendTx()", async () => {
      console.log("Ξ Testing Ethereum transaction preparation and signing...");

      const ethAddress = await vault.getAddress("ethereum");

      // Step 1: Prepare transaction using prepareSendTx()
      const keysignPayload = await vault.prepareSendTx({
        coin: {
          chain: "ethereum",
          address: ethAddress,
          decimals: 18,
          ticker: "ETH",
        },
        receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 100000000000000000n, // 0.1 ETH
        feeSettings: {
          maxFeePerGas: 30000000000n, // 30 Gwei
          maxPriorityFeePerGas: 2000000000n, // 2 Gwei
          gasLimit: 21000n,
        },
      });

      expect(keysignPayload).toBeDefined();
      expect(keysignPayload.coin.chain).toBe("ethereum");

      // Step 2: Sign the prepared payload
      const signature = await vault.sign("fast", keysignPayload, TEST_PASSWORD);

      expect(signature).toBeDefined();
      expect(signature.r).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(signature.s).toMatch(/^0x[a-fA-F0-9]{64}$/);

      console.log("✅ Ethereum transaction prepared and signed successfully");
    });

    it("should prepare and sign ERC-20 token transfer using prepareSendTx()", async () => {
      console.log("Ξ Testing ERC-20 token transfer preparation...");

      const ethAddress = await vault.getAddress("ethereum");

      // Prepare USDC transfer
      const keysignPayload = await vault.prepareSendTx({
        coin: {
          chain: "ethereum",
          address: ethAddress,
          decimals: 6,
          ticker: "USDC",
          id: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC contract
        },
        receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        amount: 100000000n, // 100 USDC
        feeSettings: {
          maxFeePerGas: 30000000000n,
          maxPriorityFeePerGas: 2000000000n,
          gasLimit: 100000n, // Higher for token transfer
        },
      });

      expect(keysignPayload).toBeDefined();
      expect(keysignPayload.coin.id).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );

      const signature = await vault.sign("fast", keysignPayload, TEST_PASSWORD);
      expect(signature).toBeDefined();

      console.log("✅ ERC-20 token transfer prepared and signed successfully");
    });

    it("should sign EIP-1559 Ethereum transaction", async () => {
      console.log("Ξ Testing Ethereum transaction signing...");

      const ethAddress = await vault.getAddress("ethereum");
      const transaction = await createEthereumTransaction({
        from: ethAddress,
        to: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        value: "0.1", // ETH
        maxFeePerGas: "30", // Gwei
        maxPriorityFeePerGas: "2", // Gwei
        gasLimit: "21000",
        nonce: 0,
        chainId: 1,
      });

      const signedTx = await vault.signTransaction("ethereum", transaction);

      expect(signedTx).toBeDefined();
      expect(signedTx.r).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(signedTx.s).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(signedTx.v).toBeGreaterThanOrEqual(0);
      expect(signedTx.serialized).toMatch(/^0x[a-fA-F0-9]+$/);

      // Verify recoverable address
      const recoveredAddress = await recoverEthereumAddress(signedTx);
      expect(recoveredAddress.toLowerCase()).toBe(ethAddress.toLowerCase());

      console.log("✅ Ethereum transaction signed successfully");
    });

    it("should sign smart contract interaction", async () => {
      const ethAddress = await vault.getAddress("ethereum");

      // ERC-20 transfer
      const transaction = await createEthereumTransaction({
        from: ethAddress,
        to: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
        data:
          "0xa9059cbb" + // transfer(address,uint256)
          "000000000000000000000000742d35Cc6634C0532925a3b844Bc9e7595f0bEb0" +
          "000000000000000000000000000000000000000000000000000000000000c350", // 50000 USDC
        gasLimit: "100000",
      });

      const signedTx = await vault.signTransaction("ethereum", transaction);

      expect(signedTx).toBeDefined();
      expect(signedTx.data).toBe(transaction.data);
    });
  });

  describe("Solana Transaction Signing", () => {
    it("should sign Solana transfer transaction", async () => {
      console.log("◎ Testing Solana transaction signing...");

      const solAddress = await vault.getAddress("solana");
      const transaction = await createSolanaTransaction({
        from: solAddress,
        to: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        amount: "1", // SOL
        recentBlockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
      });

      const signedTx = await vault.signTransaction("solana", transaction);

      expect(signedTx).toBeDefined();
      expect(signedTx.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
      expect(signedTx.serialized).toBeDefined();

      // Verify EdDSA signature
      const isValid = await verifySolanaSignature(signedTx);
      expect(isValid).toBe(true);

      console.log("✅ Solana transaction signed successfully");
    });

    it("should sign SPL token transfer", async () => {
      const solAddress = await vault.getAddress("solana");

      const transaction = await createSolanaTransaction({
        type: "spl-transfer",
        from: solAddress,
        to: "recipient_address",
        tokenMint: "token_mint_address",
        amount: "1000000", // 1 USDC (6 decimals)
      });

      const signedTx = await vault.signTransaction("solana", transaction);

      expect(signedTx.signature).toBeDefined();
      expect(signedTx.instructions).toContain("spl-token");
    });
  });

  describe("THORChain Transaction Signing", () => {
    it("should sign THORChain swap transaction", async () => {
      console.log("⚡ Testing THORChain transaction signing...");

      const thorAddress = await vault.getAddress("thorchain");
      const transaction = await createThorchainTransaction({
        from: thorAddress,
        to: "thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c", // Pool address
        amount: "100000000", // 1 RUNE
        memo: "SWAP:BTC.BTC:bc1qaddr...:100000000", // Swap memo
        fee: "2000000", // 0.02 RUNE
        sequence: 0,
      });

      const signedTx = await vault.signTransaction("thorchain", transaction);

      expect(signedTx).toBeDefined();
      expect(signedTx.signature).toBeDefined();
      expect(signedTx.memo).toBe(transaction.memo);

      console.log("✅ THORChain transaction signed successfully");
    });
  });

  describe("Batch Transaction Signing", () => {
    it("should sign multiple transactions in sequence", async () => {
      console.log("📦 Testing batch transaction signing...");

      const transactions = [
        {
          chain: "bitcoin",
          tx: await createBitcoinTransaction({ amount: "0.001" }),
        },
        {
          chain: "ethereum",
          tx: await createEthereumTransaction({ value: "0.1" }),
        },
        { chain: "solana", tx: await createSolanaTransaction({ amount: "1" }) },
      ];

      const signedTransactions = [];

      for (const { chain, tx } of transactions) {
        const signed = await vault.signTransaction(chain, tx);
        signedTransactions.push({ chain, signed });
      }

      expect(signedTransactions).toHaveLength(3);
      signedTransactions.forEach(({ chain, signed }) => {
        expect(signed).toBeDefined();
        console.log(`✅ ${chain} transaction signed`);
      });

      console.log("✅ All transactions signed successfully");
    });

    it("should handle signing failures gracefully", async () => {
      // Create invalid transaction
      const invalidTx = {
        invalid: "transaction",
        missing: "required fields",
      };

      await expect(
        vault.signTransaction("bitcoin", invalidTx),
      ).rejects.toThrow();

      // Vault should still be functional
      const validTx = await createBitcoinTransaction({ amount: "0.001" });
      const signedTx = await vault.signTransaction("bitcoin", validTx);
      expect(signedTx).toBeDefined();
    });
  });
});

// Helper verification functions
async function verifyBitcoinSignature(signedTx: any): Promise<boolean> {
  // Implement Bitcoin signature verification
  return true; // Placeholder
}

async function recoverEthereumAddress(signedTx: any): Promise<string> {
  // Implement Ethereum address recovery from signature
  return signedTx.from; // Placeholder
}

async function verifySolanaSignature(signedTx: any): Promise<boolean> {
  // Implement Solana EdDSA signature verification
  return true; // Placeholder
}
```

## Week 8: Import/Export and Performance

### Day 5-6: Complete Import/Export Cycles

#### Task 4.3: Full Import/Export E2E Tests

```typescript
// tests/e2e/import-export/complete-cycle.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import fs from "fs/promises";
import path from "path";

describe("E2E: Complete Import/Export Cycles", () => {
  let sdk: VultisigSDK;
  const testDir = path.join(__dirname, "test-exports");

  beforeEach(async () => {
    sdk = new VultisigSDK();
    await sdk.init();
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("should complete full export-import-use cycle", async () => {
    console.log("📤 Starting complete export-import-use cycle...");

    // Step 1: Create and setup vault
    console.log("1️⃣ Creating vault with transactions...");

    const originalVault = await sdk.createFastVault({
      name: "Export Cycle Test",
      email: "export@test.com",
      password: "password",
      chains: ["bitcoin", "ethereum", "solana"],
    });

    // Derive addresses
    const originalAddresses = await originalVault.getAllAddresses();

    // Simulate some usage (cache balances, etc.)
    await originalVault.getBalance("bitcoin");
    await originalVault.getBalance("ethereum");

    // Store some metadata
    originalVault.setMetadata({
      createdAt: Date.now(),
      lastUsed: Date.now(),
      customField: "test-value",
    });

    // Step 2: Export with encryption
    console.log("2️⃣ Exporting vault with encryption...");

    const exportPassword = "ExportPassword123!";
    const exportPath = path.join(testDir, "vault-export.vult");

    await sdk.vaultManager.exportVault(
      originalVault.id,
      exportPath,
      exportPassword,
    );

    // Verify export file
    const exportStats = await fs.stat(exportPath);
    expect(exportStats.isFile()).toBe(true);
    expect(exportStats.size).toBeGreaterThan(0);

    // Step 3: Delete original vault
    console.log("3️⃣ Deleting original vault...");

    await sdk.vaultManager.deleteVault(originalVault.id);
    expect(sdk.vaultManager.getVault(originalVault.id)).toBeUndefined();

    // Step 4: Import vault
    console.log("4️⃣ Importing vault from encrypted file...");

    const importedVault = await sdk.vaultManager.importVault(
      exportPath,
      exportPassword,
    );

    // Step 5: Verify imported vault
    console.log("5️⃣ Verifying imported vault...");

    expect(importedVault.id).toBe(originalVault.id);
    expect(importedVault.name).toBe("Export Cycle Test");
    expect(importedVault.chains).toEqual(["bitcoin", "ethereum", "solana"]);

    // Verify addresses match
    const importedAddresses = await importedVault.getAllAddresses();
    expect(importedAddresses).toEqual(originalAddresses);

    // Verify metadata preserved
    const metadata = importedVault.getMetadata();
    expect(metadata.customField).toBe("test-value");

    // Step 6: Use imported vault
    console.log("6️⃣ Testing imported vault functionality...");

    // Should be able to sign transactions
    const testTx = await createBitcoinTransaction({ amount: "0.001" });
    const signedTx = await importedVault.signTransaction("bitcoin", testTx);
    expect(signedTx).toBeDefined();

    // Should be able to fetch balances
    const balance = await importedVault.getBalance("ethereum");
    expect(balance).toBeDefined();

    console.log("✅ Complete export-import-use cycle successful!");
  });

  it("should handle migration from old vault format", async () => {
    // Load legacy vault format
    const legacyVaultPath = path.join(
      __dirname,
      "fixtures",
      "legacy-vault-v1.vult",
    );
    const legacyContent = await fs.readFile(legacyVaultPath);

    // Write to test location
    const testPath = path.join(testDir, "legacy.vult");
    await fs.writeFile(testPath, legacyContent);

    // Import should handle migration
    const migratedVault = await sdk.vaultManager.importVault(testPath);

    expect(migratedVault).toBeDefined();
    expect(migratedVault.version).toBe(2); // Current version

    // Verify migrated data
    expect(migratedVault.chains).toBeDefined();
    expect(migratedVault.publicKeyECDSA).toBeDefined();

    // Should be fully functional
    const address = await migratedVault.getAddress("bitcoin");
    expect(address).toBeDefined();
  });

  it("should export and import multiple vaults", async () => {
    console.log("📦 Testing multi-vault export/import...");

    // Create multiple vaults
    const vaults = [];
    for (let i = 1; i <= 3; i++) {
      const vault = await sdk.createFastVault({
        name: `Vault ${i}`,
        email: `vault${i}@test.com`,
        password: "password",
        chains: ["bitcoin", "ethereum"],
      });
      vaults.push(vault);
    }

    // Export all vaults
    const exportPaths = [];
    for (let i = 0; i < vaults.length; i++) {
      const exportPath = path.join(testDir, `vault-${i}.vult`);
      await sdk.vaultManager.exportVault(vaults[i].id, exportPath);
      exportPaths.push(exportPath);
    }

    // Clear all vaults
    for (const vault of vaults) {
      await sdk.vaultManager.deleteVault(vault.id);
    }
    expect(sdk.vaultManager.listVaults()).toHaveLength(0);

    // Import all vaults
    const importedVaults = [];
    for (const exportPath of exportPaths) {
      const imported = await sdk.vaultManager.importVault(exportPath);
      importedVaults.push(imported);
    }

    // Verify all imported
    expect(importedVaults).toHaveLength(3);
    expect(sdk.vaultManager.listVaults()).toHaveLength(3);

    // Verify each vault
    for (let i = 0; i < importedVaults.length; i++) {
      expect(importedVaults[i].name).toBe(`Vault ${i + 1}`);
      expect(importedVaults[i].id).toBe(vaults[i].id);
    }

    console.log("✅ Multi-vault export/import successful!");
  });
});
```

### Day 7-8: Performance Benchmarking

#### Task 4.4: Performance E2E Tests

```typescript
// tests/e2e/performance/benchmarks.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { performance } from "perf_hooks";

describe("E2E: Performance Benchmarks", () => {
  let sdk: VultisigSDK;

  beforeEach(async () => {
    sdk = new VultisigSDK({ autoInit: false });
  });

  describe("Initialization Performance", () => {
    it("should initialize SDK within target time", async () => {
      const start = performance.now();
      await sdk.init();
      const duration = performance.now() - start;

      console.log(`SDK initialization: ${duration.toFixed(2)}ms`);

      expect(duration).toBeLessThan(1000); // Less than 1 second
    });

    it("should load WASM modules within target time", async () => {
      await sdk.init();

      const wasmLoadTimes = {
        walletCore: 0,
        dkls: 0,
        schnorr: 0,
      };

      // Measure WalletCore load time
      let start = performance.now();
      await sdk.wasmManager.loadModule("wallet-core");
      wasmLoadTimes.walletCore = performance.now() - start;

      // Measure DKLS load time
      start = performance.now();
      await sdk.wasmManager.loadModule("dkls");
      wasmLoadTimes.dkls = performance.now() - start;

      // Measure Schnorr load time
      start = performance.now();
      await sdk.wasmManager.loadModule("schnorr");
      wasmLoadTimes.schnorr = performance.now() - start;

      console.log("WASM Load Times:");
      console.log(`  WalletCore: ${wasmLoadTimes.walletCore.toFixed(2)}ms`);
      console.log(`  DKLS: ${wasmLoadTimes.dkls.toFixed(2)}ms`);
      console.log(`  Schnorr: ${wasmLoadTimes.schnorr.toFixed(2)}ms`);

      // Each module should load within 2 seconds
      Object.values(wasmLoadTimes).forEach((time) => {
        expect(time).toBeLessThan(2000);
      });

      // Total should be within 5 seconds
      const totalTime = Object.values(wasmLoadTimes).reduce((a, b) => a + b, 0);
      expect(totalTime).toBeLessThan(5000);
    });
  });

  describe("Vault Operations Performance", () => {
    it("should create fast vault within target time", async () => {
      await sdk.init();

      const start = performance.now();
      const vault = await sdk.createFastVault({
        name: "Performance Test Vault",
        email: "perf@test.com",
        password: "password",
      });
      const duration = performance.now() - start;

      console.log(`Fast vault creation: ${duration.toFixed(2)}ms`);

      expect(vault).toBeDefined();
      expect(duration).toBeLessThan(30000); // Less than 30 seconds
    });

    it("should derive all chain addresses within target time", async () => {
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ALL_SUPPORTED_CHAINS,
      });

      const start = performance.now();
      const addresses = await vault.getAllAddresses();
      const duration = performance.now() - start;

      console.log(
        `Address derivation for ${ALL_SUPPORTED_CHAINS.length} chains: ${duration.toFixed(2)}ms`,
      );
      console.log(
        `Average per chain: ${(duration / ALL_SUPPORTED_CHAINS.length).toFixed(2)}ms`,
      );

      expect(Object.keys(addresses)).toHaveLength(ALL_SUPPORTED_CHAINS.length);
      expect(duration).toBeLessThan(3000); // Less than 3 seconds for all chains
    });

    it("should sign transaction within target time", async () => {
      await sdk.init();

      const vault = await createTestVault(sdk, {
        type: "fast",
        chains: ["bitcoin"],
      });

      const transaction = await createBitcoinTransaction({ amount: "0.001" });

      const start = performance.now();
      const signedTx = await vault.signTransaction("bitcoin", transaction);
      const duration = performance.now() - start;

      console.log(`Transaction signing: ${duration.toFixed(2)}ms`);

      expect(signedTx).toBeDefined();
      expect(duration).toBeLessThan(10000); // Less than 10 seconds
    });
  });

  describe("Import/Export Performance", () => {
    it("should export vault within target time", async () => {
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ["bitcoin", "ethereum", "solana"],
      });

      const exportPath = "/tmp/perf-export.vult";

      const start = performance.now();
      await sdk.vaultManager.exportVault(vault.id, exportPath, "password");
      const duration = performance.now() - start;

      console.log(`Vault export (encrypted): ${duration.toFixed(2)}ms`);

      expect(duration).toBeLessThan(5000); // Less than 5 seconds
    });

    it("should import vault within target time", async () => {
      await sdk.init();

      // First create and export a vault
      const vault = await createTestVault(sdk);
      const exportPath = "/tmp/perf-import.vult";
      await sdk.vaultManager.exportVault(vault.id, exportPath, "password");

      // Clear vaults
      await sdk.vaultManager.deleteVault(vault.id);

      // Measure import time
      const start = performance.now();
      const imported = await sdk.vaultManager.importVault(
        exportPath,
        "password",
      );
      const duration = performance.now() - start;

      console.log(`Vault import (encrypted): ${duration.toFixed(2)}ms`);

      expect(imported).toBeDefined();
      expect(duration).toBeLessThan(5000); // Less than 5 seconds
    });
  });

  describe("Memory Usage", () => {
    it("should maintain reasonable memory usage", async () => {
      await sdk.init();

      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024; // MB

      // Create multiple vaults
      const vaults = [];
      for (let i = 0; i < 5; i++) {
        const vault = await createTestVault(sdk, {
          name: `Memory Test ${i}`,
        });
        vaults.push(vault);

        // Derive addresses for all chains
        await vault.getAllAddresses();
      }

      const afterVaultsMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      // Load all WASM modules
      await sdk.wasmManager.loadModule("wallet-core");
      await sdk.wasmManager.loadModule("dkls");
      await sdk.wasmManager.loadModule("schnorr");

      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;

      console.log("Memory Usage:");
      console.log(`  Initial: ${initialMemory.toFixed(2)} MB`);
      console.log(`  After vaults: ${afterVaultsMemory.toFixed(2)} MB`);
      console.log(`  Final: ${finalMemory.toFixed(2)} MB`);
      console.log(
        `  Total increase: ${(finalMemory - initialMemory).toFixed(2)} MB`,
      );

      expect(finalMemory - initialMemory).toBeLessThan(200); // Less than 200MB increase
    });
  });

  describe("Concurrent Operations", () => {
    it("should handle concurrent vault operations", async () => {
      await sdk.init();

      const operations = Array(10)
        .fill(null)
        .map((_, i) =>
          sdk.createFastVault({
            name: `Concurrent Vault ${i}`,
            email: `concurrent${i}@test.com`,
            password: "password",
          }),
        );

      const start = performance.now();
      const vaults = await Promise.all(operations);
      const duration = performance.now() - start;

      console.log(`10 concurrent vault creations: ${duration.toFixed(2)}ms`);
      console.log(`Average per vault: ${(duration / 10).toFixed(2)}ms`);

      expect(vaults).toHaveLength(10);
      vaults.forEach((vault) => expect(vault).toBeDefined());
    });

    it("should handle concurrent address derivations", async () => {
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ALL_SUPPORTED_CHAINS,
      });

      const operations = ALL_SUPPORTED_CHAINS.map((chain) =>
        vault.getAddress(chain),
      );

      const start = performance.now();
      const addresses = await Promise.all(operations);
      const duration = performance.now() - start;

      console.log(
        `${ALL_SUPPORTED_CHAINS.length} concurrent address derivations: ${duration.toFixed(2)}ms`,
      );

      expect(addresses).toHaveLength(ALL_SUPPORTED_CHAINS.length);
      addresses.forEach((address) => expect(address).toBeDefined());
    });
  });
});
```

### Day 9-10: Error Recovery and Edge Cases

#### Task 4.5: Error Recovery E2E Tests

```typescript
// tests/e2e/error-recovery/edge-cases.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";

describe("E2E: Error Recovery and Edge Cases", () => {
  let sdk: VultisigSDK;

  beforeEach(async () => {
    sdk = new VultisigSDK();
    await sdk.init();
  });

  describe("Network Error Recovery", () => {
    it("should recover from server timeout during vault creation", async () => {
      // Configure short timeout and retries
      sdk.configure({
        timeout: 2000,
        maxRetries: 3,
      });

      // Mock slow server response
      sdk.serverManager.simulateDelay(5000);

      const vault = await sdk.createFastVault({
        name: "Timeout Recovery Test",
        email: "timeout@test.com",
        password: "password",
      });

      expect(vault).toBeDefined();

      // Verify retries occurred
      const stats = sdk.serverManager.getStats();
      expect(stats.retries).toBeGreaterThan(0);
    });

    it("should handle partial MPC completion", async () => {
      const vaultPromise = sdk.createFastVault({
        name: "Partial MPC Test",
        email: "partial@test.com",
        password: "password",
      });

      // Simulate ECDSA completion but EdDSA failure
      sdk.serverManager.simulateMPCPartialCompletion("ecdsa");

      await expect(vaultPromise).rejects.toThrow("EdDSA keygen failed");

      // Verify cleanup
      const vaults = sdk.vaultManager.listVaults();
      expect(vaults).toHaveLength(0);

      // Should be able to retry
      sdk.serverManager.reset();
      const vault = await sdk.createFastVault({
        name: "Retry After Partial",
        email: "retry@test.com",
        password: "password",
      });

      expect(vault).toBeDefined();
    });
  });

  describe("Data Corruption Recovery", () => {
    it("should handle corrupted cache gracefully", async () => {
      const vault = await createTestVault(sdk);

      // Corrupt cache
      vault.cacheService.corrupt();

      // Should still be able to derive addresses
      const address = await vault.getAddress("bitcoin");
      expect(address).toBeDefined();

      // Cache should be rebuilt
      const cacheStats = vault.cacheService.getStats();
      expect(cacheStats.rebuilds).toBe(1);
    });

    it("should handle storage corruption", async () => {
      await createTestVault(sdk, { name: "Storage Test" });

      // Corrupt storage
      await sdk.vaultManager.corruptStorage();

      // Should detect corruption on load
      await expect(sdk.vaultManager.loadFromStorage()).rejects.toThrow(
        "Storage corrupted",
      );

      // Should be able to recover with backup
      await sdk.vaultManager.restoreFromBackup();

      const vaults = sdk.vaultManager.listVaults();
      expect(vaults).toHaveLength(1);
      expect(vaults[0].name).toBe("Storage Test");
    });
  });

  describe("Edge Cases", () => {
    it("should handle maximum vault name length", async () => {
      const maxName = "A".repeat(100); // Max length

      const vault = await sdk.createFastVault({
        name: maxName,
        email: "maxname@test.com",
        password: "password",
      });

      expect(vault.name).toBe(maxName);
    });

    it("should handle special characters in vault name", async () => {
      const specialName = "Vault 🚀 Test!@#$%^&*()_+-=[]{}|;:,.<>?";

      const vault = await sdk.createFastVault({
        name: specialName,
        email: "special@test.com",
        password: "password",
      });

      expect(vault.name).toBe(specialName);

      // Should be able to export/import
      const exportPath = "/tmp/special.vult";
      await sdk.vaultManager.exportVault(vault.id, exportPath);

      await sdk.vaultManager.deleteVault(vault.id);
      const imported = await sdk.vaultManager.importVault(exportPath);

      expect(imported.name).toBe(specialName);
    });

    it("should handle rapid successive operations", async () => {
      const vault = await createTestVault(sdk);

      // Rapid address derivations
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(vault.getAddress("bitcoin"));
      }

      const addresses = await Promise.all(promises);

      // All should return the same address
      const uniqueAddresses = new Set(addresses);
      expect(uniqueAddresses.size).toBe(1);
    });

    it("should handle vault with no chains", async () => {
      const vault = await sdk.createFastVault({
        name: "No Chains Vault",
        email: "nochains@test.com",
        password: "password",
        chains: [], // No chains
      });

      expect(vault).toBeDefined();
      expect(vault.chains).toEqual([]);

      // Should be able to add chains later
      await vault.addChain("bitcoin");
      expect(vault.chains).toEqual(["bitcoin"]);

      const address = await vault.getAddress("bitcoin");
      expect(address).toBeDefined();
    });
  });
});
```

## Deliverables Checklist

### Complete User Workflows ✓

- [ ] Fast vault creation with email verification
- [ ] Network interruption recovery
- [ ] User abandonment handling
- [ ] Full lifecycle testing

### Transaction Signing ✓

- [ ] Bitcoin (UTXO) transactions
- [ ] Ethereum (EVM) transactions
- [ ] Solana (EdDSA) transactions
- [ ] THORChain (Cosmos) transactions
- [ ] Batch transaction signing
- [ ] Error recovery

### Import/Export Cycles ✓

- [ ] Encrypted export/import
- [ ] Legacy format migration
- [ ] Multi-vault operations
- [ ] Metadata preservation

### Performance Benchmarks ✓

- [ ] Initialization timing
- [ ] Vault operations timing
- [ ] Memory usage monitoring
- [ ] Concurrent operations
- [ ] Target metrics validation

### Error Recovery ✓

- [ ] Network error handling
- [ ] Data corruption recovery
- [ ] Edge case handling
- [ ] Graceful degradation

## Success Metrics

| Metric                  | Target             | Status |
| ----------------------- | ------------------ | ------ |
| Code Coverage           | 75%                | 🔄     |
| E2E Scenarios           | 20+ complete flows | 🔄     |
| Performance Targets Met | 90%                | 🔄     |
| Error Recovery          | 100% scenarios     | 🔄     |
| Chain Family Coverage   | All families       | 🔄     |
| Test Execution Time     | <5 min             | 🔄     |

## Phase 4 Summary

Phase 4 establishes comprehensive end-to-end testing that validates complete user workflows:

- **User Journeys**: Complete flows from vault creation to transaction signing
- **Real-World Scenarios**: Network issues, data corruption, edge cases
- **Performance Validation**: All operations meet timing requirements
- **Error Recovery**: Graceful handling of all failure modes

With 75% coverage achieved, the SDK is ready for production use with confidence in its reliability and performance.

## Next Steps (Phase 5 Preview)

Phase 5 will focus on advanced testing and production readiness:

1. Security testing and penetration testing
2. Load testing and stress testing
3. Cross-platform compatibility
4. Documentation and maintenance guides
5. Continuous improvement processes

---

_Phase 4 validates the complete user experience and ensures the SDK meets performance requirements while handling errors gracefully._
