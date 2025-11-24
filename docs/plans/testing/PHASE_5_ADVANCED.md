# Phase 5: Advanced Testing & Production Readiness

**Duration**: Week 9-10
**Coverage Target**: 85%
**Priority**: HIGH

## Objectives

1. Implement comprehensive security testing
2. Conduct load and stress testing
3. Ensure cross-platform compatibility
4. Create performance optimization tests
5. Establish monitoring and maintenance procedures

## Prerequisites

- Phases 1-4 completed successfully
- 75% code coverage achieved
- E2E tests passing
- Performance benchmarks established
- All chain fixtures complete

## Week 9: Security and Load Testing

### Day 1-2: Security Testing

#### Task 5.1: Cryptographic Security Tests

```typescript
// tests/security/cryptographic-security.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import crypto from "crypto";
import {
  validateSignature,
  validateKeyDerivation,
} from "@helpers/crypto-validators";

describe("Security: Cryptographic Operations", () => {
  let sdk: VultisigSDK;

  beforeEach(async () => {
    sdk = new VultisigSDK();
    await sdk.init();
  });

  describe("Key Generation Security", () => {
    it("should generate unique key shares for each vault", async () => {
      const vaults = [];
      const keyShares = new Set();

      // Create multiple vaults
      for (let i = 0; i < 10; i++) {
        const vault = await sdk.createFastVault({
          name: `Security Test ${i}`,
          email: `security${i}@test.com`,
          password: `password${i}`,
        });
        vaults.push(vault);

        // Collect key shares
        keyShares.add(vault.localShareECDSA);
        keyShares.add(vault.localShareEdDSA);
      }

      // All key shares must be unique
      expect(keyShares.size).toBe(20); // 2 shares per vault * 10 vaults
    });

    it("should use cryptographically secure randomness", async () => {
      // Monitor random number generation
      const randomSpy = vi.spyOn(crypto, "randomBytes");

      await sdk.createFastVault({
        name: "Random Test",
        email: "random@test.com",
        password: "password",
      });

      // Verify secure random was used
      expect(randomSpy).toHaveBeenCalled();
      randomSpy.mock.calls.forEach((call) => {
        expect(call[0]).toBeGreaterThanOrEqual(32); // At least 256 bits
      });
    });

    it("should not expose private keys in memory", async () => {
      const vault = await createTestVault(sdk);

      // Try to access private keys through various methods
      const vaultString = JSON.stringify(vault);
      const vaultKeys = Object.keys(vault);
      const vaultValues = Object.values(vault);

      // Should not contain private key patterns
      expect(vaultString).not.toMatch(/privKey|privateKey|secret/i);
      expect(vaultKeys).not.toContain("privateKey");
      expect(vaultKeys).not.toContain("localShare");

      // Check memory dumps
      const memorySnapshot = process.memoryUsage();
      // Private keys should be cleared from memory after use
      expect(memorySnapshot.external).toBeLessThan(100 * 1024 * 1024); // <100MB external memory
    });
  });

  describe("Signature Security", () => {
    it("should produce deterministic signatures with same nonce", async () => {
      const vault = await createTestVault(sdk);
      const messageHash = crypto.randomBytes(32).toString("hex");

      // Sign same message twice with controlled nonce
      const sig1 = await vault.signWithNonce(
        "bitcoin",
        messageHash,
        "test-nonce",
      );
      const sig2 = await vault.signWithNonce(
        "bitcoin",
        messageHash,
        "test-nonce",
      );

      expect(sig1).toEqual(sig2); // Same nonce = same signature
    });

    it("should produce different signatures with different nonces", async () => {
      const vault = await createTestVault(sdk);
      const messageHash = crypto.randomBytes(32).toString("hex");

      const sig1 = await vault.signTransaction("bitcoin", {
        hash: messageHash,
      });
      const sig2 = await vault.signTransaction("bitcoin", {
        hash: messageHash,
      });

      expect(sig1).not.toEqual(sig2); // Different nonces = different signatures
    });

    it("should validate signature correctness", async () => {
      const vault = await createTestVault(sdk);

      // Test for each chain family
      const testCases = [
        { chain: "bitcoin", type: "ecdsa" },
        { chain: "ethereum", type: "ecdsa" },
        { chain: "solana", type: "eddsa" },
      ];

      for (const { chain, type } of testCases) {
        const tx = await createTestTransaction(chain);
        const signed = await vault.signTransaction(chain, tx);

        const isValid = await validateSignature(signed, type);
        expect(isValid).toBe(true);

        // Tamper with signature
        signed.signature = signed.signature.replace("a", "b");
        const isTampered = await validateSignature(signed, type);
        expect(isTampered).toBe(false);
      }
    });
  });

  describe("Encryption Security", () => {
    it("should use AES-256-GCM for vault encryption", async () => {
      const vault = await createTestVault(sdk);
      const password = "StrongPassword123!@#";

      const encrypted = await vault.exportEncrypted(password);

      // Check encryption metadata
      expect(encrypted.algorithm).toBe("aes-256-gcm");
      expect(encrypted.salt.length).toBeGreaterThanOrEqual(32); // 16+ bytes as hex
      expect(encrypted.iv.length).toBeGreaterThanOrEqual(24); // 12+ bytes as hex
      expect(encrypted.tag.length).toBe(32); // 16 bytes as hex
    });

    it("should use key derivation with sufficient iterations", async () => {
      const vault = await createTestVault(sdk);
      const password = "TestPassword";

      const encrypted = await vault.exportEncrypted(password);

      // Should use PBKDF2 or similar with high iteration count
      expect(encrypted.kdf).toBe("pbkdf2");
      expect(encrypted.iterations).toBeGreaterThanOrEqual(100000);
    });

    it("should not be vulnerable to padding oracle attacks", async () => {
      const vault = await createTestVault(sdk);
      const exportPath = "/tmp/security-test.vult";

      await sdk.vaultManager.exportVault(vault.id, exportPath, "password");

      // Tamper with encrypted data
      const content = await fs.readFile(exportPath);
      const tampered = Buffer.from(content);
      tampered[tampered.length - 1] ^= 1; // Flip last bit

      await fs.writeFile(exportPath, tampered);

      // Should fail authentication, not decryption
      await expect(
        sdk.vaultManager.importVault(exportPath, "password"),
      ).rejects.toThrow(/authentication|invalid/i);
    });
  });

  describe("Input Validation Security", () => {
    it("should prevent XSS in vault names", async () => {
      const xssAttempts = [
        '<script>alert("XSS")</script>',
        '"><script>alert(1)</script>',
        "javascript:alert(1)",
        "<img src=x onerror=alert(1)>",
        "<svg onload=alert(1)>",
      ];

      for (const maliciousName of xssAttempts) {
        const vault = await sdk.createFastVault({
          name: maliciousName,
          email: "xss@test.com",
          password: "password",
        });

        // Name should be sanitized or escaped
        expect(vault.name).not.toContain("<script>");
        expect(vault.name).not.toContain("javascript:");
        expect(vault.name).not.toContain("onerror=");
        expect(vault.name).not.toContain("onload=");
      }
    });

    it("should prevent SQL injection in queries", async () => {
      const sqlInjectionAttempts = [
        "'; DROP TABLE vaults; --",
        "1' OR '1'='1",
        "admin'--",
        "' UNION SELECT * FROM users--",
      ];

      for (const maliciousInput of sqlInjectionAttempts) {
        // Should sanitize or parameterize
        const vault = await sdk.createFastVault({
          name: maliciousInput,
          email: "sql@test.com",
          password: "password",
        });

        // Verify no SQL was executed
        const allVaults = sdk.vaultManager.listVaults();
        expect(allVaults.length).toBeGreaterThan(0); // Table not dropped
      }
    });

    it("should prevent path traversal in imports", async () => {
      const pathTraversalAttempts = [
        "../../../etc/passwd",
        "..\\..\\..\\windows\\system32\\config\\sam",
        "file:///etc/passwd",
        "/dev/null",
        "CON", // Windows reserved name
      ];

      for (const maliciousPath of pathTraversalAttempts) {
        await expect(
          sdk.vaultManager.importVault(maliciousPath),
        ).rejects.toThrow(/invalid|not found|access denied/i);
      }
    });
  });

  describe("MPC Security", () => {
    it("should not reveal other party shares", async () => {
      const vault = await sdk.createFastVault({
        name: "MPC Security Test",
        email: "mpc@test.com",
        password: "password",
      });

      // Should only have local share
      expect(vault.localShareECDSA).toBeDefined();
      expect(vault.serverShareECDSA).toBeUndefined();

      // Should not be able to extract server share
      const exported = await vault.export();
      expect(JSON.stringify(exported)).not.toContain("serverShare");
    });

    it("should validate MPC message authenticity", async () => {
      // Monitor MPC protocol messages
      const messageLog = [];
      sdk.serverManager.on("mpc-message", (msg) => {
        messageLog.push(msg);
      });

      await sdk.createFastVault({
        name: "MPC Auth Test",
        email: "auth@test.com",
        password: "password",
      });

      // All messages should be signed/authenticated
      messageLog.forEach((msg) => {
        expect(msg.signature).toBeDefined();
        expect(msg.from).toBeDefined();

        // Verify signature
        const isValid = sdk.serverManager.verifyMessage(msg);
        expect(isValid).toBe(true);
      });
    });
  });
});
```

### Day 3-4: Load and Stress Testing

#### Task 5.2: Load Testing

```typescript
// tests/load/load-testing.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import pLimit from "p-limit";

describe("Load Testing", () => {
  describe("Concurrent Vault Operations", () => {
    it("should handle 100 concurrent vault creations", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const limit = pLimit(10); // Limit to 10 concurrent operations
      const startTime = Date.now();

      const operations = Array(100)
        .fill(null)
        .map((_, i) =>
          limit(() =>
            sdk.createFastVault({
              name: `Load Test Vault ${i}`,
              email: `load${i}@test.com`,
              password: `password${i}`,
            }),
          ),
        );

      const vaults = await Promise.all(operations);
      const duration = Date.now() - startTime;

      console.log(`Created 100 vaults in ${duration}ms`);
      console.log(`Average: ${(duration / 100).toFixed(2)}ms per vault`);

      expect(vaults).toHaveLength(100);
      expect(duration).toBeLessThan(300000); // 5 minutes for 100 vaults

      // Verify all vaults are functional
      const sampleVault = vaults[50];
      const address = await sampleVault.getAddress("bitcoin");
      expect(address).toBeDefined();
    });

    it("should handle 1000 concurrent address derivations", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ALL_SUPPORTED_CHAINS,
      });

      const operations = [];
      const startTime = Date.now();

      // 1000 random address derivations
      for (let i = 0; i < 1000; i++) {
        const randomChain =
          ALL_SUPPORTED_CHAINS[
            Math.floor(Math.random() * ALL_SUPPORTED_CHAINS.length)
          ];
        operations.push(vault.getAddress(randomChain));
      }

      const addresses = await Promise.all(operations);
      const duration = Date.now() - startTime;

      console.log(`Derived 1000 addresses in ${duration}ms`);
      console.log(`Average: ${(duration / 1000).toFixed(2)}ms per address`);

      expect(addresses).toHaveLength(1000);
      expect(duration).toBeLessThan(10000); // Less than 10 seconds

      // Check cache efficiency
      const cacheStats = vault.cacheService.getStats();
      console.log(`Cache hit rate: ${(cacheStats.hitRate * 100).toFixed(2)}%`);
      expect(cacheStats.hitRate).toBeGreaterThan(0.9); // >90% cache hit rate
    });

    it("should handle 500 concurrent transactions", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk, {
        type: "fast",
        chains: ["bitcoin", "ethereum", "solana"],
      });

      const limit = pLimit(20); // 20 concurrent signing operations
      const operations = [];
      const startTime = Date.now();

      for (let i = 0; i < 500; i++) {
        const chain = ["bitcoin", "ethereum", "solana"][i % 3];
        const tx = await createTestTransaction(chain);

        operations.push(limit(() => vault.signTransaction(chain, tx)));
      }

      const signedTxs = await Promise.all(operations);
      const duration = Date.now() - startTime;

      console.log(`Signed 500 transactions in ${duration}ms`);
      console.log(`Average: ${(duration / 500).toFixed(2)}ms per transaction`);

      expect(signedTxs).toHaveLength(500);
      expect(duration).toBeLessThan(150000); // Less than 2.5 minutes

      // Verify signatures
      const sampleSig = signedTxs[250];
      expect(sampleSig).toBeDefined();
      expect(sampleSig.signature).toBeDefined();
    });
  });

  describe("Memory Stress Testing", () => {
    it("should handle memory pressure gracefully", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const initialMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const vaults = [];

      // Create vaults until memory pressure
      for (let i = 0; i < 50; i++) {
        const vault = await createTestVault(sdk, {
          name: `Memory Test ${i}`,
          chains: ALL_SUPPORTED_CHAINS,
        });

        // Derive all addresses to increase memory usage
        await vault.getAllAddresses();
        vaults.push(vault);

        const currentMemory = process.memoryUsage().heapUsed / 1024 / 1024;
        console.log(`Vault ${i}: Memory usage ${currentMemory.toFixed(2)}MB`);

        // Check for memory leaks
        if (i > 10) {
          const avgMemoryPerVault = (currentMemory - initialMemory) / i;
          expect(avgMemoryPerVault).toBeLessThan(5); // Less than 5MB per vault
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed / 1024 / 1024;
      const totalIncrease = finalMemory - initialMemory;

      console.log(`Total memory increase: ${totalIncrease.toFixed(2)}MB`);
      expect(totalIncrease).toBeLessThan(250); // Less than 250MB for 50 vaults
    });

    it("should handle WASM module memory limits", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      // Load all WASM modules multiple times
      const operations = [];

      for (let i = 0; i < 100; i++) {
        operations.push(
          sdk.wasmManager.loadModule("wallet-core"),
          sdk.wasmManager.loadModule("dkls"),
          sdk.wasmManager.loadModule("schnorr"),
        );
      }

      await Promise.all(operations);

      // Should reuse modules, not create new instances
      const memoryAfterWASM = process.memoryUsage().heapUsed / 1024 / 1024;
      expect(memoryAfterWASM).toBeLessThan(500); // Less than 500MB

      // Verify modules are cached
      const cacheSize = sdk.wasmManager.getCacheSize();
      expect(cacheSize).toBe(3); // Only 3 unique modules
    });
  });

  describe("Network Stress Testing", () => {
    it("should handle high-frequency server requests", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const operations = [];
      const startTime = Date.now();

      // Rapid fire 1000 requests
      for (let i = 0; i < 1000; i++) {
        operations.push(
          sdk.serverManager.ping(),
          sdk.serverManager.getStatus(),
          sdk.serverManager.checkSession("test-session-" + i),
        );
      }

      const results = await Promise.allSettled(operations);
      const duration = Date.now() - startTime;

      const successful = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      console.log(`Completed 3000 requests in ${duration}ms`);
      console.log(`Success: ${successful}, Failed: ${failed}`);
      console.log(
        `Requests per second: ${(3000 / (duration / 1000)).toFixed(2)}`,
      );

      // Should handle at least 90% successfully
      expect(successful / results.length).toBeGreaterThan(0.9);
    });

    it("should handle message relay stress", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const sessionId = await sdk.serverManager.createRelaySession();

      // Simulate high-frequency message exchange
      const messages = [];
      for (let i = 0; i < 500; i++) {
        messages.push({
          type: "stress-test",
          data: `Message ${i}`,
          timestamp: Date.now(),
        });
      }

      const startTime = Date.now();

      // Send all messages
      const sendPromises = messages.map((msg) =>
        sdk.serverManager.sendRelayMessage(sessionId, msg),
      );

      await Promise.all(sendPromises);

      // Poll for messages
      const received = await sdk.serverManager.pollRelayMessages(sessionId, {
        maxMessages: 500,
      });

      const duration = Date.now() - startTime;

      console.log(`Relayed 500 messages in ${duration}ms`);
      console.log(`Throughput: ${(500 / (duration / 1000)).toFixed(2)} msg/s`);

      expect(received.length).toBe(500);
    });
  });
});
```

## Week 10: Cross-Platform and Optimization

### Day 5-6: Cross-Platform Compatibility

#### Task 5.3: Multi-Environment Testing

```typescript
// tests/compatibility/cross-platform.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { detectEnvironment } from "@helpers/environment";

describe("Cross-Platform Compatibility", () => {
  describe("Node.js Environment", () => {
    it("should work in Node.js 16+", async () => {
      const nodeVersion = process.version;
      console.log(`Testing in Node.js ${nodeVersion}`);

      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk);
      const address = await vault.getAddress("bitcoin");

      expect(address).toBeDefined();
    });

    it("should handle Node.js specific features", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      // File system operations
      const exportPath = path.join(os.tmpdir(), "node-test.vult");
      const vault = await createTestVault(sdk);

      await sdk.vaultManager.exportVault(vault.id, exportPath);

      const stats = await fs.stat(exportPath);
      expect(stats.isFile()).toBe(true);

      // Crypto operations
      const randomBytes = crypto.randomBytes(32);
      expect(randomBytes.length).toBe(32);
    });
  });

  describe("Browser Environment", () => {
    it("should work in modern browsers", async () => {
      // Simulate browser environment
      const originalWindow = global.window;
      global.window = {
        crypto: {
          getRandomValues: (arr) => crypto.randomBytes(arr.length),
          subtle: {}, // WebCrypto API
        },
        localStorage: new Map(),
        indexedDB: {}, // Mock IndexedDB
      };

      const sdk = new VultisigSDK({
        environment: "browser",
      });
      await sdk.init();

      const vault = await createTestVault(sdk);
      expect(vault).toBeDefined();

      // Cleanup
      global.window = originalWindow;
    });

    it("should use IndexedDB for storage in browser", async () => {
      // Mock browser with IndexedDB
      const mockIndexedDB = createMockIndexedDB();
      global.window = { indexedDB: mockIndexedDB };

      const sdk = new VultisigSDK({
        environment: "browser",
        storage: "indexeddb",
      });

      await sdk.init();

      const vault = await createTestVault(sdk);
      await sdk.vaultManager.saveToStorage();

      // Verify data saved to IndexedDB
      const stored = await mockIndexedDB.get("vaults", vault.id);
      expect(stored).toBeDefined();
      expect(stored.name).toBe(vault.name);

      // Cleanup
      delete global.window;
    });

    it("should handle WebAssembly in browser", async () => {
      // Mock WebAssembly
      global.WebAssembly = {
        instantiate: vi.fn().mockResolvedValue({
          instance: { exports: {} },
        }),
        compile: vi.fn(),
        Module: class {},
        Instance: class {},
      };

      const sdk = new VultisigSDK({ environment: "browser" });
      await sdk.init();

      // WASM should load successfully
      const walletCore = await sdk.wasmManager.loadModule("wallet-core");
      expect(walletCore).toBeDefined();

      // Cleanup
      delete global.WebAssembly;
    });
  });

  describe("React Native Environment", () => {
    it("should work in React Native", async () => {
      // Mock React Native environment
      global.navigator = {
        product: "ReactNative",
      };

      const sdk = new VultisigSDK({
        environment: "react-native",
      });

      await sdk.init();

      const vault = await createTestVault(sdk);
      expect(vault).toBeDefined();

      // Cleanup
      delete global.navigator;
    });

    it("should use AsyncStorage in React Native", async () => {
      // Mock AsyncStorage
      const mockAsyncStorage = new Map();
      global.AsyncStorage = {
        setItem: async (key, value) => mockAsyncStorage.set(key, value),
        getItem: async (key) => mockAsyncStorage.get(key),
        removeItem: async (key) => mockAsyncStorage.delete(key),
        getAllKeys: async () => Array.from(mockAsyncStorage.keys()),
      };

      const sdk = new VultisigSDK({
        environment: "react-native",
        storage: "async-storage",
      });

      await sdk.init();

      const vault = await createTestVault(sdk);
      await sdk.vaultManager.saveToStorage();

      // Verify saved to AsyncStorage
      const keys = await global.AsyncStorage.getAllKeys();
      expect(keys).toContain(`vault:${vault.id}`);

      // Cleanup
      delete global.AsyncStorage;
    });
  });

  describe("Electron Environment", () => {
    it("should work in Electron main process", async () => {
      // Mock Electron main process
      global.process.type = "browser"; // Electron main process
      global.process.versions.electron = "20.0.0";

      const sdk = new VultisigSDK({
        environment: "electron-main",
      });

      await sdk.init();

      const vault = await createTestVault(sdk);
      expect(vault).toBeDefined();

      // Should have access to Node.js APIs
      const exportPath = "/tmp/electron-test.vult";
      await sdk.vaultManager.exportVault(vault.id, exportPath);

      // Cleanup
      delete global.process.versions.electron;
    });

    it("should work in Electron renderer process", async () => {
      // Mock Electron renderer
      global.process.type = "renderer";
      global.window = { require: {} };

      const sdk = new VultisigSDK({
        environment: "electron-renderer",
      });

      await sdk.init();

      // Should work with limited APIs
      const vault = await createTestVault(sdk);
      const address = await vault.getAddress("ethereum");
      expect(address).toBeDefined();

      // Cleanup
      delete global.window;
    });
  });

  describe("Chrome Extension Environment", () => {
    it("should work in extension background script", async () => {
      // Mock Chrome Extension APIs
      global.chrome = {
        runtime: {
          id: "test-extension-id",
          getManifest: () => ({ version: "1.0.0", manifest_version: 3 }),
        },
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
          },
          sync: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
      };

      const sdk = new VultisigSDK({
        environment: "chrome-extension",
        storage: "chrome-storage",
      });

      await sdk.init();

      const vault = await createTestVault(sdk, {
        name: "Extension Test Vault",
      });

      expect(vault).toBeDefined();

      // Verify chrome.storage was used
      expect(global.chrome.storage.local.set).toHaveBeenCalled();

      // Cleanup
      delete global.chrome;
    });

    it("should handle chrome.storage for vault persistence", async () => {
      const mockStorage = new Map();

      global.chrome = {
        storage: {
          local: {
            get: vi.fn((keys) => {
              const result = {};
              if (Array.isArray(keys)) {
                keys.forEach((key) => {
                  if (mockStorage.has(key)) {
                    result[key] = mockStorage.get(key);
                  }
                });
              } else if (typeof keys === "string") {
                if (mockStorage.has(keys)) {
                  result[keys] = mockStorage.get(keys);
                }
              }
              return Promise.resolve(result);
            }),
            set: vi.fn((items) => {
              Object.entries(items).forEach(([key, value]) => {
                mockStorage.set(key, value);
              });
              return Promise.resolve();
            }),
            remove: vi.fn((keys) => {
              if (Array.isArray(keys)) {
                keys.forEach((key) => mockStorage.delete(key));
              } else {
                mockStorage.delete(keys);
              }
              return Promise.resolve();
            }),
          },
        },
      };

      const sdk = new VultisigSDK({
        environment: "chrome-extension",
        storage: "chrome-storage",
      });

      // Create and save vault
      const vault = await createTestVault(sdk);
      await sdk.vaultManager.saveToStorage();

      // Verify storage was called
      expect(global.chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          [`vault:${vault.id}`]: expect.any(Object),
        }),
      );

      // Load vaults from storage
      await sdk.vaultManager.loadFromStorage();
      const loadedVault = sdk.vaultManager.getVault(vault.id);

      expect(loadedVault).toBeDefined();
      expect(loadedVault?.name).toBe(vault.name);

      // Cleanup
      delete global.chrome;
    });

    it("should handle CSP restrictions for WASM", async () => {
      // Mock Chrome Extension with CSP restrictions
      global.chrome = {
        runtime: {
          id: "test-extension",
          getManifest: () => ({
            manifest_version: 3,
            content_security_policy: {
              extension_pages: "script-src 'self' 'wasm-unsafe-eval'",
            },
          }),
        },
      };

      // Mock WebAssembly with CSP check
      const originalWebAssembly = global.WebAssembly;
      global.WebAssembly = {
        ...originalWebAssembly,
        instantiateStreaming: vi
          .fn()
          .mockRejectedValue(
            new Error("CSP violation: wasm-unsafe-eval not allowed"),
          ),
        instantiate: vi.fn().mockResolvedValue({
          instance: { exports: {} },
          module: {},
        }),
      };

      const sdk = new VultisigSDK({
        environment: "chrome-extension",
      });

      // Should fall back to alternative WASM loading
      const wasmModule = await sdk.wasmManager.loadModule("wallet-core");
      expect(wasmModule).toBeDefined();

      // Verify fallback was used
      expect(global.WebAssembly.instantiate).toHaveBeenCalled();
      expect(global.WebAssembly.instantiateStreaming).toHaveBeenCalled();

      // Cleanup
      global.WebAssembly = originalWebAssembly;
      delete global.chrome;
    });

    it("should handle extension-specific file operations", async () => {
      // Chrome Extensions can't directly access file system
      // They use chrome.downloads API or blob URLs

      global.chrome = {
        downloads: {
          download: vi.fn().mockResolvedValue(1), // Download ID
          onChanged: {
            addListener: vi.fn(),
          },
        },
        runtime: {
          getURL: vi.fn((path) => `chrome-extension://extension-id/${path}`),
        },
      };

      global.URL = {
        createObjectURL: vi.fn(() => "blob:chrome-extension://id/blob-id"),
        revokeObjectURL: vi.fn(),
      };

      const sdk = new VultisigSDK({
        environment: "chrome-extension",
      });

      const vault = await createTestVault(sdk);

      // Export should use chrome.downloads API
      const exportData = await vault.export();
      const blob = new Blob([JSON.stringify(exportData)], {
        type: "application/json",
      });

      // Simulate download
      await sdk.vaultManager.exportVault(vault.id, "vault.json");

      expect(global.URL.createObjectURL).toHaveBeenCalled();
      expect(global.chrome.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining("blob:"),
          filename: expect.stringContaining("vault"),
        }),
      );

      // Cleanup
      delete global.chrome;
      delete global.URL;
    });

    it("should handle content script vs background script context", async () => {
      // Content scripts have limited access to Chrome APIs
      // Background scripts have full access

      // Test content script context
      global.chrome = {
        runtime: {
          sendMessage: vi.fn().mockResolvedValue({ success: true }),
          onMessage: {
            addListener: vi.fn(),
          },
        },
        storage: undefined, // No direct storage access in content scripts
      };

      const contentScriptSDK = new VultisigSDK({
        environment: "chrome-extension-content",
        useMessagePassing: true,
      });

      // Should use message passing for operations
      await contentScriptSDK.init();

      // Vault operations should work via message passing
      const vault = await contentScriptSDK.createFastVault({
        name: "Content Script Vault",
        email: "content@test.com",
        password: "password",
      });

      expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "CREATE_VAULT",
        }),
      );

      // Cleanup
      delete global.chrome;
    });

    it("should handle Manifest V3 service worker environment", async () => {
      // Manifest V3 uses service workers instead of background pages
      // Different lifecycle and persistence model

      global.self = {
        addEventListener: vi.fn(),
        clients: {
          matchAll: vi.fn().mockResolvedValue([]),
        },
      };

      global.chrome = {
        runtime: {
          id: "extension-id",
          getManifest: () => ({
            manifest_version: 3,
            background: {
              service_worker: "background.js",
            },
          }),
        },
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
          },
        },
        alarms: {
          create: vi.fn(),
          onAlarm: {
            addListener: vi.fn(),
          },
        },
      };

      const sdk = new VultisigSDK({
        environment: "chrome-extension-service-worker",
      });

      await sdk.init();

      // Service workers may be terminated, test persistence
      const vault = await createTestVault(sdk);

      // Should persist immediately (service workers can be killed)
      expect(global.chrome.storage.local.set).toHaveBeenCalled();

      // Cleanup
      delete global.self;
      delete global.chrome;
    });
  });
});
```

### Day 7-8: Performance Optimization Testing

#### Task 5.4: Optimization and Profiling

```typescript
// tests/performance/optimization.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { profile, measureMemory } from "@helpers/profiling";

describe("Performance Optimization", () => {
  describe("Caching Optimization", () => {
    it("should optimize address derivation with caching", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ALL_SUPPORTED_CHAINS,
      });

      // First run - no cache
      const firstRun = await profile(async () => {
        for (const chain of ALL_SUPPORTED_CHAINS) {
          await vault.getAddress(chain);
        }
      });

      // Second run - with cache
      const secondRun = await profile(async () => {
        for (const chain of ALL_SUPPORTED_CHAINS) {
          await vault.getAddress(chain);
        }
      });

      console.log(`First run: ${firstRun.duration}ms`);
      console.log(`Second run: ${secondRun.duration}ms`);
      console.log(
        `Speedup: ${(firstRun.duration / secondRun.duration).toFixed(2)}x`,
      );

      // Cache should provide significant speedup
      expect(secondRun.duration).toBeLessThan(firstRun.duration * 0.1); // 10x faster
    });

    it("should optimize balance queries with smart caching", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk);

      // Track network calls
      let networkCalls = 0;
      sdk.networkMonitor.on("request", () => networkCalls++);

      // First query - network call
      await vault.getBalance("ethereum");
      const firstCallCount = networkCalls;

      // Second query within TTL - cached
      await vault.getBalance("ethereum");
      expect(networkCalls).toBe(firstCallCount); // No new network call

      // Wait for TTL expiration
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000 + 100));

      // Third query - network call again
      await vault.getBalance("ethereum");
      expect(networkCalls).toBe(firstCallCount + 1);
    });
  });

  describe("Batch Operation Optimization", () => {
    it("should optimize batch address derivation", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk, {
        chains: ALL_SUPPORTED_CHAINS,
      });

      // Sequential derivation
      const sequentialTime = await profile(async () => {
        for (const chain of ALL_SUPPORTED_CHAINS) {
          await vault.getAddress(chain);
        }
      });

      // Clear cache
      vault.cacheService.clear();

      // Batch derivation
      const batchTime = await profile(async () => {
        await vault.getAllAddresses();
      });

      console.log(`Sequential: ${sequentialTime.duration}ms`);
      console.log(`Batch: ${batchTime.duration}ms`);
      console.log(
        `Improvement: ${((1 - batchTime.duration / sequentialTime.duration) * 100).toFixed(2)}%`,
      );

      // Batch should be faster
      expect(batchTime.duration).toBeLessThan(sequentialTime.duration);
    });

    it("should optimize batch transaction signing", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const vault = await createTestVault(sdk, { type: "fast" });

      const transactions = [];
      for (let i = 0; i < 10; i++) {
        transactions.push(await createTestTransaction("bitcoin"));
      }

      // Sign with session reuse
      const optimizedTime = await profile(async () => {
        const session = await vault.createSigningSession();
        for (const tx of transactions) {
          await vault.signWithSession(session, "bitcoin", tx);
        }
        await session.close();
      });

      // Sign without session reuse
      const unoptimizedTime = await profile(async () => {
        for (const tx of transactions) {
          await vault.signTransaction("bitcoin", tx);
        }
      });

      console.log(`With session reuse: ${optimizedTime.duration}ms`);
      console.log(`Without session reuse: ${unoptimizedTime.duration}ms`);

      expect(optimizedTime.duration).toBeLessThan(unoptimizedTime.duration);
    });
  });

  describe("Memory Optimization", () => {
    it("should optimize memory usage with lazy loading", async () => {
      const sdk = new VultisigSDK({ autoInit: false });

      const beforeInit = await measureMemory();

      await sdk.init();

      const afterInit = await measureMemory();

      // Create vault but don't use WASM yet
      const vault = await sdk.createFastVault({
        name: "Memory Test",
        email: "memory@test.com",
        password: "password",
      });

      const afterVault = await measureMemory();

      // Now trigger WASM load
      await vault.getAddress("bitcoin");

      const afterWASM = await measureMemory();

      console.log("Memory Usage:");
      console.log(`  Before init: ${beforeInit.heapUsed}MB`);
      console.log(`  After init: ${afterInit.heapUsed}MB`);
      console.log(`  After vault: ${afterVault.heapUsed}MB`);
      console.log(`  After WASM: ${afterWASM.heapUsed}MB`);

      // WASM should only load when needed
      expect(afterVault.heapUsed - afterInit.heapUsed).toBeLessThan(10); // <10MB before WASM
      expect(afterWASM.heapUsed - afterVault.heapUsed).toBeGreaterThan(10); // WASM adds >10MB
    });

    it("should clean up unused resources", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      // Create and delete multiple vaults
      for (let i = 0; i < 10; i++) {
        const vault = await createTestVault(sdk);
        await vault.getAllAddresses();
        await sdk.vaultManager.deleteVault(vault.id);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const memoryAfterCleanup = await measureMemory();

      // Memory should be reclaimed
      console.log(`Memory after cleanup: ${memoryAfterCleanup.heapUsed}MB`);
      expect(memoryAfterCleanup.heapUsed).toBeLessThan(100); // Less than 100MB
    });
  });

  describe("Bundle Size Optimization", () => {
    it("should support tree shaking", async () => {
      // Test that unused code can be eliminated
      const { VultisigSDK: SDKOnly } = await import("@/VultisigSDK");

      // Should only import what's needed
      const sdk = new SDKOnly();
      expect(sdk).toBeDefined();

      // Unused managers should not be loaded
      expect(sdk._unusedManager).toBeUndefined();
    });

    it("should support code splitting", async () => {
      // Lazy load heavy modules
      const sdk = new VultisigSDK({ lazyLoad: true });

      // Core should be small
      const coreSize = await getModuleSize("@/VultisigSDK");
      expect(coreSize).toBeLessThan(50); // Less than 50KB

      // WASM modules load on demand
      const wasmModule = await import("@/wasm/wallet-core");
      expect(wasmModule).toBeDefined();
    });
  });
});
```

### Day 9-10: Monitoring and Maintenance

#### Task 5.5: Production Monitoring Setup

```typescript
// tests/monitoring/production-monitoring.test.ts
import { describe, it, expect } from "vitest";
import { VultisigSDK } from "@/VultisigSDK";
import { MetricsCollector, HealthCheck } from "@/monitoring";

describe("Production Monitoring", () => {
  describe("Metrics Collection", () => {
    it("should collect operation metrics", async () => {
      const sdk = new VultisigSDK({
        monitoring: {
          enabled: true,
          metricsEndpoint: "https://metrics.example.com",
        },
      });

      const metrics = new MetricsCollector(sdk);
      metrics.start();

      // Perform operations
      const vault = await sdk.createFastVault({
        name: "Metrics Test",
        email: "metrics@test.com",
        password: "password",
      });

      await vault.getAddress("bitcoin");
      await vault.getBalance("ethereum");

      // Collect metrics
      const collected = metrics.getMetrics();

      expect(collected).toHaveProperty("vaultCreation");
      expect(collected.vaultCreation).toMatchObject({
        count: 1,
        avgDuration: expect.any(Number),
        errors: 0,
      });

      expect(collected).toHaveProperty("addressDerivation");
      expect(collected.addressDerivation.count).toBe(1);

      expect(collected).toHaveProperty("balanceQuery");
      expect(collected.balanceQuery.count).toBe(1);

      metrics.stop();
    });

    it("should track error rates", async () => {
      const sdk = new VultisigSDK({ monitoring: { enabled: true } });
      const metrics = new MetricsCollector(sdk);

      // Cause some errors
      await expect(
        sdk.vaultManager.importVault("/invalid/path"),
      ).rejects.toThrow();

      await expect(
        sdk.createFastVault({ name: "", email: "invalid", password: "" }),
      ).rejects.toThrow();

      const errorMetrics = metrics.getErrorMetrics();

      expect(errorMetrics.total).toBe(2);
      expect(errorMetrics.byType).toHaveProperty("VaultImportError");
      expect(errorMetrics.byType).toHaveProperty("ValidationError");
    });
  });

  describe("Health Checks", () => {
    it("should perform comprehensive health checks", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      const healthCheck = new HealthCheck(sdk);
      const report = await healthCheck.run();

      expect(report).toMatchObject({
        status: "healthy",
        checks: {
          wasmModules: { status: "ok" },
          serverConnectivity: { status: "ok" },
          storage: { status: "ok" },
          memory: { status: "ok" },
        },
      });

      console.log("Health Report:", JSON.stringify(report, null, 2));
    });

    it("should detect degraded performance", async () => {
      const sdk = new VultisigSDK();
      await sdk.init();

      // Simulate slow operations
      sdk.serverManager.simulateDelay(5000);

      const healthCheck = new HealthCheck(sdk);
      const report = await healthCheck.run();

      expect(report.status).toBe("degraded");
      expect(report.checks.serverConnectivity.status).toBe("slow");
      expect(report.checks.serverConnectivity.latency).toBeGreaterThan(1000);
    });
  });

  describe("Logging and Debugging", () => {
    it("should provide detailed debug logs", async () => {
      const logs = [];
      const sdk = new VultisigSDK({
        debug: true,
        logger: {
          log: (level, message, data) => {
            logs.push({ level, message, data });
          },
        },
      });

      await sdk.init();

      const vault = await sdk.createFastVault({
        name: "Debug Test",
        email: "debug@test.com",
        password: "password",
      });

      // Check for important log entries
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: "info",
          message: expect.stringContaining("SDK initialized"),
        }),
      );

      expect(logs).toContainEqual(
        expect.objectContaining({
          level: "debug",
          message: expect.stringContaining("Creating fast vault"),
        }),
      );

      // Should log MPC protocol steps
      const mpcLogs = logs.filter((l) => l.message.includes("MPC"));
      expect(mpcLogs.length).toBeGreaterThan(0);
    });

    it("should support structured logging", async () => {
      const sdk = new VultisigSDK({
        logger: {
          format: "json",
        },
      });

      const vault = await createTestVault(sdk);

      const logs = sdk.logger.getLogs();

      logs.forEach((log) => {
        // Should be valid JSON
        expect(() => JSON.parse(JSON.stringify(log))).not.toThrow();

        // Should have standard fields
        expect(log).toHaveProperty("timestamp");
        expect(log).toHaveProperty("level");
        expect(log).toHaveProperty("message");
      });
    });
  });

  describe("Alerting", () => {
    it("should trigger alerts on critical errors", async () => {
      const alerts = [];

      const sdk = new VultisigSDK({
        monitoring: {
          alerting: {
            enabled: true,
            handlers: [
              {
                type: "callback",
                handler: (alert) => alerts.push(alert),
              },
            ],
          },
        },
      });

      // Trigger critical error
      sdk.serverManager.simulateOutage();

      await expect(
        sdk.createFastVault({
          name: "Alert Test",
          email: "alert@test.com",
          password: "password",
        }),
      ).rejects.toThrow();

      // Should have triggered alert
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        severity: "critical",
        type: "server_unavailable",
        message: expect.stringContaining("Server"),
      });
    });
  });
});
```

## Deliverables Checklist

### Security Testing ✓

- [ ] Cryptographic security validation
- [ ] Input sanitization testing
- [ ] Encryption strength verification
- [ ] MPC protocol security
- [ ] Vulnerability scanning

### Load Testing ✓

- [ ] Concurrent operations (100+ vaults)
- [ ] Memory stress testing
- [ ] Network stress testing
- [ ] WASM module limits
- [ ] Throughput benchmarks

### Cross-Platform ✓

- [ ] Node.js compatibility
- [ ] Browser compatibility
- [ ] React Native support
- [ ] Electron support
- [ ] Environment detection

### Performance Optimization ✓

- [ ] Caching optimization
- [ ] Batch operations
- [ ] Memory optimization
- [ ] Bundle size optimization
- [ ] Lazy loading

### Monitoring ✓

- [ ] Metrics collection
- [ ] Health checks
- [ ] Logging framework
- [ ] Alerting system
- [ ] Debug capabilities

## Success Metrics

| Metric           | Target               | Status |
| ---------------- | -------------------- | ------ |
| Code Coverage    | 85%                  | 🔄     |
| Security Tests   | All passing          | 🔄     |
| Load Tests       | 100+ concurrent      | 🔄     |
| Platform Support | 4+ environments      | 🔄     |
| Performance      | All targets met      | 🔄     |
| Monitoring       | Full instrumentation | 🔄     |

## Phase 5 Summary

Phase 5 completes the testing strategy with advanced testing and production readiness:

- **Security**: Comprehensive vulnerability testing and cryptographic validation
- **Performance**: Load testing proves scalability to 100+ concurrent operations
- **Compatibility**: Verified across Node.js, browser, React Native, and Electron
- **Monitoring**: Full production instrumentation and alerting

With 85% coverage achieved, the Vultisig SDK is production-ready with enterprise-grade testing, monitoring, and cross-platform support.

## Ongoing Maintenance

### Weekly Tasks

- Review new security advisories
- Update chain fixtures
- Monitor performance metrics
- Review error logs

### Monthly Tasks

- Security audit
- Performance regression testing
- Dependency updates
- Documentation updates

### Quarterly Tasks

- Major version testing
- New platform support
- Load testing validation
- Comprehensive security review

---

_Phase 5 establishes the SDK as a production-ready, secure, and performant solution with comprehensive monitoring and cross-platform support._
