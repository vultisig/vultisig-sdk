# Phase 2: Core Components Testing

**Duration**: Week 3-4
**Coverage Target**: 50%
**Priority**: HIGH

## Objectives

1. Comprehensive unit tests for VultisigSDK main class
2. Complete Vault and VaultManager testing
3. ChainManager tests with all chain fixtures
4. Service layer testing (Cache, FastSigning)
5. Adapter pattern validation

## Prerequisites

- Phase 1 completed successfully
- Testing infrastructure operational
- Chain fixtures for Tier 1 chains populated
- Mock factories functional
- 30% code coverage baseline achieved

## Week 3: Core SDK Components

### Day 1-2: VultisigSDK Class Tests

#### Task 2.1: Main SDK Class Tests

```typescript
// tests/unit/VultisigSDK.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { mockWASMModules } from "@helpers/wasm-mocks";
import { setupServerMocks } from "@helpers/server-mocks";

describe("VultisigSDK", () => {
  let sdk: VultisigSDK;

  beforeEach(async () => {
    setupServerMocks();
    mockWASMModules();
    sdk = new VultisigSDK({
      apiUrl: "https://test.api.vultisig.com",
      autoInit: false,
    });
  });

  describe("initialization", () => {
    it("should initialize with default config", () => {
      const defaultSdk = new VultisigSDK();
      expect(defaultSdk).toBeDefined();
      expect(defaultSdk.vaultManager).toBeDefined();
      expect(defaultSdk.chainManager).toBeDefined();
    });

    it("should initialize with custom config", () => {
      const customSdk = new VultisigSDK({
        apiUrl: "https://custom.api.com",
        autoInit: true,
        defaultChains: ["bitcoin", "ethereum"],
      });

      expect(customSdk.config.apiUrl).toBe("https://custom.api.com");
      expect(customSdk.config.defaultChains).toEqual(["bitcoin", "ethereum"]);
    });

    it("should lazy load WASM modules", async () => {
      const loadSpy = vi.spyOn(sdk.wasmManager, "loadModule");

      await sdk.init();

      expect(loadSpy).not.toHaveBeenCalled();

      // WASM should load on first use
      await sdk.vaultManager.createVault({
        name: "Test Vault",
        chains: ["bitcoin"],
      });

      expect(loadSpy).toHaveBeenCalled();
    });
  });

  describe("vault operations", () => {
    it("should create a fast vault", async () => {
      const vault = await sdk.createFastVault({
        name: "Test Fast Vault",
        email: "test@example.com",
        password: "SecurePassword123!",
      });

      expect(vault).toBeDefined();
      expect(vault.name).toBe("Test Fast Vault");
      expect(vault.type).toBe("fast");
      expect(vault.threshold).toBe(2);
    });

    it("should handle vault creation errors", async () => {
      // Mock server error
      vi.spyOn(sdk.serverManager, "createFastVault").mockRejectedValue(
        new Error("Server error"),
      );

      await expect(
        sdk.createFastVault({
          name: "Test",
          email: "test@example.com",
          password: "pass",
        }),
      ).rejects.toThrow("Server error");
    });

    it("should list all vaults", async () => {
      await sdk.createFastVault({
        name: "Vault 1",
        email: "test1@example.com",
        password: "pass1",
      });

      await sdk.createFastVault({
        name: "Vault 2",
        email: "test2@example.com",
        password: "pass2",
      });

      const vaults = await sdk.listVaults();
      expect(vaults).toHaveLength(2);
      expect(vaults[0].name).toBe("Vault 1");
      expect(vaults[1].name).toBe("Vault 2");
    });
  });

  describe("chain operations", () => {
    it("should get supported chains", () => {
      const chains = sdk.getSupportedChains();

      expect(chains).toContain("bitcoin");
      expect(chains).toContain("ethereum");
      expect(chains).toContain("solana");
      expect(chains.length).toBeGreaterThanOrEqual(30);
    });

    it("should validate chain names", () => {
      expect(sdk.isValidChain("bitcoin")).toBe(true);
      expect(sdk.isValidChain("ethereum")).toBe(true);
      expect(sdk.isValidChain("invalid_chain")).toBe(false);
    });
  });
});
```

### Day 3-4: Vault Class Tests

#### Task 2.2: Vault Instance Tests

```typescript
// tests/unit/vault/Vault.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Vault } from "@/vault/Vault";
import { loadChainFixture } from "@helpers/fixture-loaders";

describe("Vault", () => {
  let vault: Vault;
  const mockVaultData = {
    id: "test-vault-id",
    name: "Test Vault",
    publicKeyECDSA: "mock_ecdsa_pubkey",
    publicKeyEdDSA: "mock_eddsa_pubkey",
    chains: ["bitcoin", "ethereum", "solana"],
    type: "fast",
    threshold: 2,
  };

  beforeEach(() => {
    vault = new Vault(mockVaultData);
  });

  describe("address derivation", () => {
    it("should derive Bitcoin address", async () => {
      const btcFixture = await loadChainFixture("bitcoin");
      const address = await vault.getAddress("bitcoin");

      expect(address).toBeDefined();
      expect(address).toMatch(/^(bc1|1|3)/); // Bitcoin address formats
    });

    it("should derive Ethereum address", async () => {
      const ethFixture = await loadChainFixture("ethereum");
      const address = await vault.getAddress("ethereum");

      expect(address).toBeDefined();
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it("should derive Solana address", async () => {
      const solFixture = await loadChainFixture("solana");
      const address = await vault.getAddress("solana");

      expect(address).toBeDefined();
      expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/); // Base58
    });

    it("should cache derived addresses", async () => {
      const deriveSpy = vi.spyOn(vault.addressService, "deriveAddress");

      const address1 = await vault.getAddress("bitcoin");
      const address2 = await vault.getAddress("bitcoin");

      expect(address1).toBe(address2);
      expect(deriveSpy).toHaveBeenCalledTimes(1); // Only derived once
    });

    it("should derive addresses for all chains", async () => {
      const addresses = await vault.getAllAddresses();

      expect(addresses).toHaveProperty("bitcoin");
      expect(addresses).toHaveProperty("ethereum");
      expect(addresses).toHaveProperty("solana");
      expect(Object.keys(addresses)).toHaveLength(3);
    });
  });

  describe("balance operations", () => {
    it("should fetch native token balance", async () => {
      const balance = await vault.getBalance("ethereum");

      expect(balance).toBeDefined();
      expect(balance.value).toBeDefined();
      expect(balance.decimals).toBe(18); // ETH decimals
      expect(balance.formatted).toBeDefined();
    });

    it("should fetch token balances", async () => {
      const tokens = await vault.getTokenBalances("ethereum");

      expect(tokens).toBeInstanceOf(Array);
      // Test with mock token data
      if (tokens.length > 0) {
        expect(tokens[0]).toHaveProperty("contract");
        expect(tokens[0]).toHaveProperty("balance");
        expect(tokens[0]).toHaveProperty("symbol");
      }
    });

    it("should cache balances with TTL", async () => {
      const fetchSpy = vi.spyOn(vault.balanceService, "fetchBalance");

      await vault.getBalance("bitcoin");
      await vault.getBalance("bitcoin");

      expect(fetchSpy).toHaveBeenCalledTimes(1); // Cached

      // Fast forward time past TTL (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      await vault.getBalance("bitcoin");
      expect(fetchSpy).toHaveBeenCalledTimes(2); // Cache expired
    });

    it("should refresh balances on demand", async () => {
      const fetchSpy = vi.spyOn(vault.balanceService, "fetchBalance");

      await vault.getBalance("ethereum");
      await vault.refreshBalance("ethereum");

      expect(fetchSpy).toHaveBeenCalledTimes(2); // Force refresh
    });
  });

  describe("chain management", () => {
    it("should add a new chain", async () => {
      await vault.addChain("polygon");

      expect(vault.chains).toContain("polygon");
      expect(vault.chains).toHaveLength(4);
    });

    it("should not add duplicate chains", async () => {
      await vault.addChain("bitcoin");

      expect(vault.chains).toHaveLength(3); // No change
    });

    it("should remove a chain", async () => {
      await vault.removeChain("solana");

      expect(vault.chains).not.toContain("solana");
      expect(vault.chains).toHaveLength(2);
    });

    it("should validate chain before adding", async () => {
      await expect(vault.addChain("invalid_chain")).rejects.toThrow();
    });
  });

  describe("vault export", () => {
    it("should export vault data", () => {
      const exported = vault.export();

      expect(exported).toHaveProperty("id");
      expect(exported).toHaveProperty("name");
      expect(exported).toHaveProperty("publicKeyECDSA");
      expect(exported).toHaveProperty("chains");
      expect(exported).not.toHaveProperty("privateKeys"); // Security
    });

    it("should export with encryption", async () => {
      const password = "SecurePassword123";
      const encrypted = await vault.exportEncrypted(password);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toEqual(vault.export());
      expect(encrypted).toHaveProperty("encrypted", true);
      expect(encrypted).toHaveProperty("data");
    });
  });

  describe("transaction preparation", () => {
    it("should prepare send transaction for native coin", async () => {
      const payload = await vault.prepareSendTx({
        coin: {
          chain: "ethereum",
          address: await vault.getAddress("ethereum"),
          decimals: 18,
          ticker: "ETH",
        },
        receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        amount: 1000000000000000000n, // 1 ETH
      });

      expect(payload).toBeDefined();
      expect(payload).toHaveProperty("coin");
      expect(payload).toHaveProperty("toAddress");
      expect(payload).toHaveProperty("toAmount");
      expect(payload.toAddress).toBe(
        "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
      );
    });

    it("should prepare send transaction for token", async () => {
      const payload = await vault.prepareSendTx({
        coin: {
          chain: "ethereum",
          address: await vault.getAddress("ethereum"),
          decimals: 6,
          ticker: "USDC",
          id: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        },
        receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        amount: 100000000n, // 100 USDC
      });

      expect(payload).toBeDefined();
      expect(payload.coin.id).toBe(
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      );
    });

    it("should prepare send transaction with memo", async () => {
      const payload = await vault.prepareSendTx({
        coin: {
          chain: "thorchain",
          address: await vault.getAddress("thorchain"),
          decimals: 8,
          ticker: "RUNE",
        },
        receiver: "thor1abc...",
        amount: 100000000n, // 1 RUNE
        memo: "SWAP:BTC.BTC:bc1q...",
      });

      expect(payload).toBeDefined();
      expect(payload).toHaveProperty("memo");
      expect(payload.memo).toBe("SWAP:BTC.BTC:bc1q...");
    });

    it("should prepare send transaction with custom fee settings", async () => {
      const payload = await vault.prepareSendTx({
        coin: {
          chain: "ethereum",
          address: await vault.getAddress("ethereum"),
          decimals: 18,
          ticker: "ETH",
        },
        receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        amount: 1000000000000000000n,
        feeSettings: {
          maxPriorityFeePerGas: 2000000000n,
          gasLimit: 100000n,
        },
      });

      expect(payload).toBeDefined();
      // Note: feeSettings are applied internally by buildSendKeysignPayload
    });

    it("should handle errors in prepareSendTx", async () => {
      await expect(
        vault.prepareSendTx({
          coin: {
            chain: "invalid-chain",
            address: "invalid",
            decimals: 18,
            ticker: "INVALID",
          },
          receiver: "invalid",
          amount: 1000n,
        }),
      ).rejects.toThrow();
    });

    it("should validate receiver address format", async () => {
      await expect(
        vault.prepareSendTx({
          coin: {
            chain: "ethereum",
            address: await vault.getAddress("ethereum"),
            decimals: 18,
            ticker: "ETH",
          },
          receiver: "not-a-valid-eth-address",
          amount: 1000000000000000000n,
        }),
      ).rejects.toThrow();
    });

    it("should prepare send transactions for all chain types", async () => {
      const chains = [
        {
          chain: "bitcoin",
          address: await vault.getAddress("bitcoin"),
          decimals: 8,
          ticker: "BTC",
          receiver: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        },
        {
          chain: "ethereum",
          address: await vault.getAddress("ethereum"),
          decimals: 18,
          ticker: "ETH",
          receiver: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        },
        {
          chain: "solana",
          address: await vault.getAddress("solana"),
          decimals: 9,
          ticker: "SOL",
          receiver: "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK",
        },
      ];

      for (const { chain, address, decimals, ticker, receiver } of chains) {
        const payload = await vault.prepareSendTx({
          coin: { chain, address, decimals, ticker },
          receiver,
          amount: 1000000n,
        });

        expect(payload).toBeDefined();
        expect(payload.coin.chain).toBe(chain);
        expect(payload.toAddress).toBe(receiver);
      }
    });
  });
});
```

### Day 5: VaultManager Tests

#### Task 2.3: VaultManager Comprehensive Tests

```typescript
// tests/unit/vault/VaultManager.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { VaultManager } from "@/VaultManager";
import { VaultError, VaultErrorCode } from "@/vault/VaultError";
import fs from "fs/promises";

describe("VaultManager", () => {
  let vaultManager: VaultManager;
  const mockStoragePath = "/tmp/test-vaults";

  beforeEach(async () => {
    vaultManager = new VaultManager({
      storagePath: mockStoragePath,
    });

    // Mock file system
    vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    vi.spyOn(fs, "readFile").mockResolvedValue(Buffer.from("{}"));
    vi.spyOn(fs, "unlink").mockResolvedValue(undefined);
    vi.spyOn(fs, "readdir").mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("vault creation", () => {
    it("should create a new vault", async () => {
      const vault = await vaultManager.createVault({
        name: "New Vault",
        chains: ["bitcoin", "ethereum"],
        type: "fast",
      });

      expect(vault).toBeDefined();
      expect(vault.name).toBe("New Vault");
      expect(vault.chains).toEqual(["bitcoin", "ethereum"]);
      expect(vault.type).toBe("fast");
    });

    it("should validate vault name uniqueness", async () => {
      await vaultManager.createVault({ name: "Unique Vault" });

      await expect(
        vaultManager.createVault({ name: "Unique Vault" }),
      ).rejects.toThrow('Vault with name "Unique Vault" already exists');
    });

    it("should apply default chains if not specified", async () => {
      const vault = await vaultManager.createVault({
        name: "Default Chains Vault",
      });

      expect(vault.chains).toContain("bitcoin");
      expect(vault.chains).toContain("ethereum");
      expect(vault.chains).toContain("solana");
    });
  });

  describe("vault import/export", () => {
    it("should import vault from file", async () => {
      const vaultData = {
        id: "imported-vault",
        name: "Imported Vault",
        publicKeyECDSA: "imported_ecdsa_key",
        chains: ["bitcoin"],
      };

      vi.spyOn(fs, "readFile").mockResolvedValue(
        Buffer.from(JSON.stringify(vaultData)),
      );

      const vault = await vaultManager.importVault("/path/to/vault.vult");

      expect(vault.id).toBe("imported-vault");
      expect(vault.name).toBe("Imported Vault");
    });

    it("should import encrypted vault", async () => {
      const encryptedData = {
        encrypted: true,
        data: "encrypted_vault_data_base64",
        salt: "salt_base64",
        iv: "iv_base64",
      };

      vi.spyOn(fs, "readFile").mockResolvedValue(
        Buffer.from(JSON.stringify(encryptedData)),
      );

      const vault = await vaultManager.importVault(
        "/path/to/encrypted.vult",
        "password123",
      );

      expect(vault).toBeDefined();
    });

    it("should export vault to file", async () => {
      const vault = await vaultManager.createVault({
        name: "Export Test",
      });

      const writeSpy = vi.spyOn(fs, "writeFile");
      await vaultManager.exportVault(vault.id, "/path/to/export.vult");

      expect(writeSpy).toHaveBeenCalled();
      const exportedData = writeSpy.mock.calls[0][1];
      expect(exportedData).toContain("Export Test");
    });

    it("should handle corrupted vault files", async () => {
      vi.spyOn(fs, "readFile").mockResolvedValue(
        Buffer.from("corrupted data not json"),
      );

      await expect(
        vaultManager.importVault("/path/to/corrupted.vult"),
      ).rejects.toThrow(VaultError);
    });
  });

  describe("vault management", () => {
    let vault1: any, vault2: any;

    beforeEach(async () => {
      vault1 = await vaultManager.createVault({ name: "Vault 1" });
      vault2 = await vaultManager.createVault({ name: "Vault 2" });
    });

    it("should list all vaults", () => {
      const vaults = vaultManager.listVaults();

      expect(vaults).toHaveLength(2);
      expect(vaults[0].name).toBe("Vault 1");
      expect(vaults[1].name).toBe("Vault 2");
    });

    it("should get vault by ID", () => {
      const vault = vaultManager.getVault(vault1.id);

      expect(vault).toBeDefined();
      expect(vault?.id).toBe(vault1.id);
    });

    it("should set active vault", () => {
      vaultManager.setActiveVault(vault2.id);

      const active = vaultManager.getActiveVault();
      expect(active?.id).toBe(vault2.id);
    });

    it("should delete vault", async () => {
      await vaultManager.deleteVault(vault1.id);

      const vaults = vaultManager.listVaults();
      expect(vaults).toHaveLength(1);
      expect(vaultManager.getVault(vault1.id)).toBeUndefined();
    });

    it("should not delete active vault", async () => {
      vaultManager.setActiveVault(vault1.id);

      await expect(vaultManager.deleteVault(vault1.id)).rejects.toThrow(
        "Cannot delete active vault",
      );
    });
  });

  describe("persistence", () => {
    it("should save vaults to storage", async () => {
      const writeSpy = vi.spyOn(fs, "writeFile");

      await vaultManager.createVault({ name: "Persistent Vault" });
      await vaultManager.saveToStorage();

      expect(writeSpy).toHaveBeenCalledWith(
        expect.stringContaining("vaults.json"),
        expect.stringContaining("Persistent Vault"),
        "utf-8",
      );
    });

    it("should load vaults from storage", async () => {
      const vaultData = [
        { id: "vault1", name: "Stored Vault 1" },
        { id: "vault2", name: "Stored Vault 2" },
      ];

      vi.spyOn(fs, "readFile").mockResolvedValue(
        Buffer.from(JSON.stringify(vaultData)),
      );

      await vaultManager.loadFromStorage();
      const vaults = vaultManager.listVaults();

      expect(vaults).toHaveLength(2);
      expect(vaults[0].name).toBe("Stored Vault 1");
    });
  });
});
```

## Week 4: Services and Adapters

### Day 6-7: Service Layer Tests

#### Task 2.4: CacheService Tests

```typescript
// tests/unit/vault/services/CacheService.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CacheService } from "@/vault/services/CacheService";

describe("CacheService", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    cacheService = new CacheService();
    vi.useFakeTimers();
  });

  describe("basic operations", () => {
    it("should set and get values", () => {
      cacheService.set("key1", "value1");

      expect(cacheService.get("key1")).toBe("value1");
    });

    it("should return undefined for missing keys", () => {
      expect(cacheService.get("nonexistent")).toBeUndefined();
    });

    it("should delete values", () => {
      cacheService.set("key1", "value1");
      cacheService.delete("key1");

      expect(cacheService.get("key1")).toBeUndefined();
    });

    it("should clear all values", () => {
      cacheService.set("key1", "value1");
      cacheService.set("key2", "value2");
      cacheService.clear();

      expect(cacheService.get("key1")).toBeUndefined();
      expect(cacheService.get("key2")).toBeUndefined();
    });
  });

  describe("TTL functionality", () => {
    it("should expire values after TTL", () => {
      cacheService.set("key1", "value1", 1000); // 1 second TTL

      expect(cacheService.get("key1")).toBe("value1");

      vi.advanceTimersByTime(1001);

      expect(cacheService.get("key1")).toBeUndefined();
    });

    it("should use default TTL", () => {
      const defaultTTL = 5 * 60 * 1000; // 5 minutes
      cacheService = new CacheService({ defaultTTL });

      cacheService.set("key1", "value1");

      vi.advanceTimersByTime(defaultTTL - 1);
      expect(cacheService.get("key1")).toBe("value1");

      vi.advanceTimersByTime(2);
      expect(cacheService.get("key1")).toBeUndefined();
    });

    it("should handle permanent cache (no TTL)", () => {
      cacheService.set("permanent", "forever", null);

      vi.advanceTimersByTime(Number.MAX_SAFE_INTEGER);

      expect(cacheService.get("permanent")).toBe("forever");
    });
  });

  describe("namespace functionality", () => {
    it("should isolate values by namespace", () => {
      cacheService.set("key1", "value1", null, "namespace1");
      cacheService.set("key1", "value2", null, "namespace2");

      expect(cacheService.get("key1", "namespace1")).toBe("value1");
      expect(cacheService.get("key1", "namespace2")).toBe("value2");
    });

    it("should clear namespace independently", () => {
      cacheService.set("key1", "value1", null, "ns1");
      cacheService.set("key2", "value2", null, "ns2");

      cacheService.clearNamespace("ns1");

      expect(cacheService.get("key1", "ns1")).toBeUndefined();
      expect(cacheService.get("key2", "ns2")).toBe("value2");
    });
  });

  describe("cache statistics", () => {
    it("should track cache hits and misses", () => {
      cacheService.set("key1", "value1");

      cacheService.get("key1"); // hit
      cacheService.get("key1"); // hit
      cacheService.get("missing"); // miss

      const stats = cacheService.getStats();

      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.67, 2);
    });

    it("should track cache size", () => {
      cacheService.set("key1", "value1");
      cacheService.set("key2", "value2");

      const stats = cacheService.getStats();

      expect(stats.size).toBe(2);
    });
  });
});
```

#### Task 2.5: FastSigningService Tests

```typescript
// tests/unit/vault/services/FastSigningService.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { FastSigningService } from "@/vault/services/FastSigningService";
import { mockServer } from "@helpers/server-mocks";

describe("FastSigningService", () => {
  let signingService: FastSigningService;
  const mockVaultData = {
    publicKeyECDSA: "mock_ecdsa_pubkey",
    localShareECDSA: "mock_ecdsa_share",
    publicKeyEdDSA: "mock_eddsa_pubkey",
    localShareEdDSA: "mock_eddsa_share",
  };

  beforeEach(() => {
    signingService = new FastSigningService(mockVaultData);
  });

  describe("ECDSA signing", () => {
    it("should sign Bitcoin transaction", async () => {
      const messageHash = "0x" + "a".repeat(64);

      const signature = await signingService.signECDSA({
        chain: "bitcoin",
        messageHash,
        derivationPath: "m/84'/0'/0'/0/0",
      });

      expect(signature).toBeDefined();
      expect(signature).toHaveProperty("r");
      expect(signature).toHaveProperty("s");
      expect(signature).toHaveProperty("v");
    });

    it("should sign Ethereum transaction", async () => {
      const messageHash = "0x" + "b".repeat(64);

      const signature = await signingService.signECDSA({
        chain: "ethereum",
        messageHash,
        derivationPath: "m/44'/60'/0'/0/0",
      });

      expect(signature).toBeDefined();
      expect(signature).toHaveProperty("r");
      expect(signature).toHaveProperty("s");
      expect(signature).toHaveProperty("v");
      expect([27, 28]).toContain(signature.v);
    });

    it("should handle signing errors", async () => {
      vi.spyOn(signingService, "coordinateWithServer").mockRejectedValue(
        new Error("Server timeout"),
      );

      await expect(
        signingService.signECDSA({
          chain: "bitcoin",
          messageHash: "0x" + "c".repeat(64),
        }),
      ).rejects.toThrow("Server timeout");
    });
  });

  describe("EdDSA signing", () => {
    it("should sign Solana transaction", async () => {
      const messageHash = Buffer.from("d".repeat(32)).toString("hex");

      const signature = await signingService.signEdDSA({
        chain: "solana",
        messageHash,
        derivationPath: "m/44'/501'/0'/0'",
      });

      expect(signature).toBeDefined();
      expect(signature).toHaveProperty("signature");
      expect(signature.signature).toMatch(/^[a-fA-F0-9]{128}$/);
    });

    it("should handle EdDSA signing errors", async () => {
      vi.spyOn(signingService, "coordinateWithServer").mockRejectedValue(
        new Error("Invalid message hash"),
      );

      await expect(
        signingService.signEdDSA({
          chain: "solana",
          messageHash: "invalid",
        }),
      ).rejects.toThrow("Invalid message hash");
    });
  });

  describe("server coordination", () => {
    it("should create signing session", async () => {
      const session = await signingService.createSigningSession({
        chain: "bitcoin",
        messageHash: "0x" + "e".repeat(64),
      });

      expect(session).toHaveProperty("sessionId");
      expect(session).toHaveProperty("serviceId");
    });

    it("should handle session timeout", async () => {
      vi.useFakeTimers();

      const sessionPromise = signingService.createSigningSession({
        chain: "ethereum",
        messageHash: "0x" + "f".repeat(64),
        timeout: 5000,
      });

      vi.advanceTimersByTime(5001);

      await expect(sessionPromise).rejects.toThrow("Session timeout");

      vi.useRealTimers();
    });

    it("should retry on temporary failures", async () => {
      let attempts = 0;
      vi.spyOn(signingService, "pollMessages").mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return { success: true };
      });

      const result = await signingService.signWithRetry({
        chain: "bitcoin",
        messageHash: "0x" + "1".repeat(64),
      });

      expect(attempts).toBe(3);
      expect(result).toBeDefined();
    });
  });
});
```

### Day 8-9: Adapter Tests

#### Task 2.6: Balance/Gas Adapters Tests

```typescript
// tests/unit/vault/adapters/balance-gas-adapters.test.ts
import { describe, it, expect } from "vitest";
import { formatBalance, formatGasInfo } from "@/vault/adapters";
import { loadChainFixture } from "@helpers/fixture-loaders";

describe("Balance and Gas Adapters", () => {
  describe("formatBalance", () => {
    it("should format Bitcoin balance (8 decimals)", () => {
      const formatted = formatBalance("100000000", 8); // 1 BTC

      expect(formatted).toBe("1.00000000");
    });

    it("should format Ethereum balance (18 decimals)", () => {
      const formatted = formatBalance("1000000000000000000", 18); // 1 ETH

      expect(formatted).toBe("1.000000000000000000");
    });

    it("should format Solana balance (9 decimals)", () => {
      const formatted = formatBalance("1000000000", 9); // 1 SOL

      expect(formatted).toBe("1.000000000");
    });

    it("should handle zero balance", () => {
      const formatted = formatBalance("0", 18);

      expect(formatted).toBe("0.000000000000000000");
    });

    it("should handle fractional amounts", () => {
      const formatted = formatBalance("123456789", 8);

      expect(formatted).toBe("1.23456789");
    });
  });

  describe("parseTokenBalance", () => {
    it("should parse ERC-20 token balance", async () => {
      const ethFixture = await loadChainFixture("ethereum");
      const tokenData = ethFixture.balances.tokens[0];

      const parsed = parseTokenBalance(tokenData);

      expect(parsed).toHaveProperty("balance");
      expect(parsed).toHaveProperty("formatted");
      expect(parsed).toHaveProperty("symbol");
      expect(parsed).toHaveProperty("decimals");
    });

    it("should parse SPL token balance", async () => {
      const solFixture = await loadChainFixture("solana");
      const tokenData = solFixture.balances.tokens?.[0];

      if (tokenData) {
        const parsed = parseTokenBalance(tokenData);

        expect(parsed).toHaveProperty("balance");
        expect(parsed).toHaveProperty("formatted");
      }
    });
  });

  describe("convertToUSD", () => {
    it("should convert balance to USD value", () => {
      const btcBalance = "100000000"; // 1 BTC
      const btcPrice = 50000; // $50k per BTC

      const usdValue = convertToUSD(btcBalance, 8, btcPrice);

      expect(usdValue).toBe(50000);
    });

    it("should handle fractional amounts", () => {
      const ethBalance = "500000000000000000"; // 0.5 ETH
      const ethPrice = 3000; // $3k per ETH

      const usdValue = convertToUSD(ethBalance, 18, ethPrice);

      expect(usdValue).toBe(1500);
    });

    it("should return 0 for zero balance", () => {
      const usdValue = convertToUSD("0", 18, 3000);

      expect(usdValue).toBe(0);
    });
  });
});
```

### Day 10: Integration Preparation

#### Task 2.8: Test Coverage Report

```typescript
// tests/scripts/coverage-report.ts
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";

const execAsync = promisify(exec);

async function generateCoverageReport() {
  console.log("Generating coverage report for Phase 2...");

  try {
    // Run tests with coverage
    const { stdout, stderr } = await execAsync("npm run test:coverage");

    // Parse coverage summary
    const coverageFile = path.join(
      __dirname,
      "../../coverage/coverage-summary.json",
    );
    const coverage = JSON.parse(await fs.readFile(coverageFile, "utf-8"));

    // Check if we met Phase 2 target (50%)
    const metrics = {
      lines: coverage.total.lines.pct,
      statements: coverage.total.statements.pct,
      functions: coverage.total.functions.pct,
      branches: coverage.total.branches.pct,
    };

    console.log("\n📊 Phase 2 Coverage Report:");
    console.log("================================");
    console.log(`Lines:      ${metrics.lines.toFixed(2)}% (Target: 50%)`);
    console.log(`Statements: ${metrics.statements.toFixed(2)}% (Target: 50%)`);
    console.log(`Functions:  ${metrics.functions.toFixed(2)}% (Target: 50%)`);
    console.log(`Branches:   ${metrics.branches.toFixed(2)}% (Target: 50%)`);

    const avgCoverage = Object.values(metrics).reduce((a, b) => a + b, 0) / 4;

    if (avgCoverage >= 50) {
      console.log("\n✅ Phase 2 coverage target achieved!");
    } else {
      console.log(`\n⚠️  Current coverage: ${avgCoverage.toFixed(2)}%`);
      console.log("   Additional tests needed to reach 50% target");
    }

    // Generate detailed report
    await generateDetailedReport(coverage);
  } catch (error) {
    console.error("Error generating coverage report:", error);
    process.exit(1);
  }
}

async function generateDetailedReport(coverage: any) {
  const report = [];

  report.push("# Phase 2 Coverage Details\n");
  report.push("## File Coverage\n");

  for (const [file, data] of Object.entries(coverage)) {
    if (file === "total") continue;

    const fileCoverage = data as any;
    report.push(`### ${file}`);
    report.push(`- Lines: ${fileCoverage.lines.pct}%`);
    report.push(`- Statements: ${fileCoverage.statements.pct}%`);
    report.push(`- Functions: ${fileCoverage.functions.pct}%`);
    report.push(`- Branches: ${fileCoverage.branches.pct}%`);
    report.push("");
  }

  const reportPath = path.join(__dirname, "../../coverage/phase-2-report.md");
  await fs.writeFile(reportPath, report.join("\n"));

  console.log(`\n📄 Detailed report saved to: ${reportPath}`);
}

// Run the report
generateCoverageReport();
```

## Deliverables Checklist

### Core SDK Tests ✓

- [ ] VultisigSDK class comprehensive tests
- [ ] Configuration and initialization tests
- [ ] WASM lazy loading tests
- [ ] Error handling tests

### Vault Tests ✓

- [ ] Vault instance tests
- [ ] Address derivation for all Tier 1 chains
- [ ] Balance operations with caching
- [ ] Chain management operations
- [ ] Export/encryption functionality

### VaultManager Tests ✓

- [ ] Vault lifecycle management
- [ ] Import/export operations
- [ ] Storage persistence
- [ ] Active vault management
- [ ] Error scenarios

### Service Layer Tests ✓

- [ ] CacheService with TTL
- [ ] FastSigningService with MPC
- [ ] Server coordination
- [ ] Retry logic and timeouts

### Adapter Tests ✓

- [ ] Transaction adapters for all chain families
- [ ] Balance formatting adapters
- [ ] Message hash extraction
- [ ] Chain-specific formatting

## Success Metrics

| Metric                 | Target          | Status |
| ---------------------- | --------------- | ------ |
| Code Coverage          | 50%             | 🔄     |
| Core Components Tested | 100%            | 🔄     |
| Service Layer Tested   | 100%            | 🔄     |
| Adapter Coverage       | 80%             | 🔄     |
| Test Execution Time    | <60s            | 🔄     |
| Chain Coverage         | Tier 1 Complete | 🔄     |

## Common Issues & Solutions

### Issue 1: Async Test Timeouts

**Solution**: Increase timeout for integration tests involving WASM or server calls.

```typescript
it("long running test", async () => {
  // test code
}, 30000); // 30 second timeout
```

### Issue 2: Mock Data Inconsistency

**Solution**: Always use fixtures from `@fixtures` instead of hardcoded values.

### Issue 3: Race Conditions in Tests

**Solution**: Use `waitFor` helpers and proper async/await patterns.

### Issue 4: Memory Leaks in Tests

**Solution**: Clean up resources in `afterEach` hooks, especially WASM modules.

## Phase 2 Summary

Phase 2 establishes comprehensive testing for the core SDK components:

- **VultisigSDK**: Main entry point fully tested
- **Vault & VaultManager**: Complete lifecycle coverage
- **Services**: Cache and signing services validated
- **Adapters**: Chain-specific adapters tested

With 50% coverage achieved, the SDK's core functionality is now validated and ready for integration testing in Phase 3.

## Next Steps (Phase 3 Preview)

Phase 3 will focus on integration testing:

1. Multi-component interaction tests
2. Full vault lifecycle integration
3. Address derivation for ALL 30+ chains
4. Server coordination scenarios
5. WASM module integration

---

_Phase 2 provides comprehensive unit testing for core components. This foundation enables confident integration testing in Phase 3._
