# Phase 1: Testing Foundation

**Duration**: Week 1-2
**Coverage Target**: 30%
**Priority**: CRITICAL

## Objectives

1. Establish robust testing infrastructure
2. Create comprehensive chain fixture framework
3. Implement mock strategies for external dependencies
4. Write initial unit tests for utility functions
5. Set up CI/CD pipeline with coverage reporting

## Week 1: Infrastructure Setup

### Day 1-2: Testing Framework Configuration

#### Task 1.1: Enhance Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{js,ts}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      exclude: [
        "node_modules/",
        "tests/",
        "*.config.ts",
        "**/types/**",
        "**/dist/**",
      ],
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 30,
        statements: 30,
      },
    },
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@core": path.resolve(__dirname, "../core"),
      "@lib": path.resolve(__dirname, "../lib"),
      "@fixtures": path.resolve(__dirname, "./tests/fixtures"),
      "@helpers": path.resolve(__dirname, "./tests/helpers"),
    },
  },
});
```

#### Task 1.2: Create Test Setup File

```typescript
// tests/setup.ts
import { vi } from "vitest";
import { mockWASMModules } from "./helpers/wasm-mocks";
import { mockServerResponses } from "./helpers/server-mocks";
import { loadChainFixtures } from "./helpers/fixture-loaders";

// Global test setup
beforeAll(async () => {
  // Mock WASM modules globally
  mockWASMModules();

  // Load chain fixtures
  await loadChainFixtures();

  // Set test environment variables
  process.env.NODE_ENV = "test";
  process.env.VULTISIG_API = "https://test.api.vultisig.com";
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

// Cleanup after all tests
afterAll(() => {
  vi.unstubAllGlobals();
});
```

### Day 3-4: Chain Fixture Framework

#### Task 1.3: Create Fixture Generator Script

```typescript
// tests/scripts/generate-fixtures.ts
import fs from "fs/promises";
import path from "path";

const CHAINS = [
  "bitcoin",
  "ethereum",
  "solana",
  "thorchain",
  "ripple",
  "polygon",
  "binance-smart-chain",
  "avalanche",
  "arbitrum",
  "optimism",
  "cosmos",
  "osmosis",
  "litecoin",
  "dogecoin",
  "bitcoin-cash",
  // ... all 30+ chains
];

interface ChainFixture {
  addresses: {
    valid: Array<{
      address: string;
      publicKey: string;
      derivationPath: string;
      type?: string;
    }>;
    invalid: string[];
  };
  transactions: {
    unsigned: Record<string, any>;
    signed: Record<string, any>;
    messageHashes: Record<string, string>;
  };
  balances: {
    native: {
      address: string;
      balance: string;
      decimals: number;
      formatted: string;
    };
    tokens?: Array<{
      contract: string;
      balance: string;
      decimals: number;
      symbol: string;
    }>;
  };
  rpcResponses: Record<string, any>;
}

async function generateChainFixtures() {
  for (const chain of CHAINS) {
    const fixturePath = path.join(__dirname, "../fixtures/chains", chain);
    await fs.mkdir(fixturePath, { recursive: true });

    // Generate default fixture structure
    const defaultFixture: ChainFixture = {
      addresses: {
        valid: [],
        invalid: [],
      },
      transactions: {
        unsigned: {},
        signed: {},
        messageHashes: {},
      },
      balances: {
        native: {
          address: "",
          balance: "0",
          decimals: 0,
          formatted: "0",
        },
      },
      rpcResponses: {},
    };

    // Write individual fixture files
    await fs.writeFile(
      path.join(fixturePath, "addresses.json"),
      JSON.stringify(defaultFixture.addresses, null, 2),
    );
    await fs.writeFile(
      path.join(fixturePath, "transactions.json"),
      JSON.stringify(defaultFixture.transactions, null, 2),
    );
    await fs.writeFile(
      path.join(fixturePath, "balances.json"),
      JSON.stringify(defaultFixture.balances, null, 2),
    );
    await fs.writeFile(
      path.join(fixturePath, "rpc-responses.json"),
      JSON.stringify(defaultFixture.rpcResponses, null, 2),
    );
  }
}

// Run generator
generateChainFixtures().catch(console.error);
```

#### Task 1.4: Populate Tier 1 Chain Fixtures

**Bitcoin Fixtures** (`tests/fixtures/chains/bitcoin/`)

```json
// addresses.json
{
  "valid": [
    {
      "address": "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "publicKey": "0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
      "derivationPath": "m/84'/0'/0'/0/0",
      "type": "p2wpkh"
    },
    {
      "address": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      "publicKey": "04678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5f",
      "derivationPath": "m/44'/0'/0'/0/0",
      "type": "p2pkh"
    }
  ],
  "invalid": ["invalid_btc_address", "bc1qinvalid", "3InvalidP2SH"]
}
```

**Ethereum Fixtures** (`tests/fixtures/chains/ethereum/`)

```json
// addresses.json
{
  "valid": [
    {
      "address": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      "publicKey": "0x04e68acfc0253a10620dff706b0a1b1f1f5833ea3beb3bde2250d5f271f3563606672ebc45e0b7ea2e816ecb70ca03137b1c9476eec63d4632e990020b7b6fba39",
      "derivationPath": "m/44'/60'/0'/0/0"
    }
  ],
  "invalid": [
    "0xinvalid",
    "not_an_address",
    "0x71C7656EC7ab88b098defB751B7401B5f6d8976G"
  ]
}

// transactions.json
{
  "unsigned": {
    "simple": {
      "to": "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
      "value": "1000000000000000000",
      "gasLimit": "21000",
      "maxFeePerGas": "20000000000",
      "maxPriorityFeePerGas": "1000000000",
      "nonce": 0,
      "chainId": 1,
      "type": 2
    }
  },
  "messageHashes": {
    "simple": "0x..."
  }
}
```

### Day 4-5: Environment Detection and Mock Strategies

#### Task 1.4: Create Environment Detection Utilities

```typescript
// src/utils/environment.ts
export type Environment =
  | "node"
  | "browser"
  | "electron-main"
  | "electron-renderer"
  | "chrome-extension"
  | "chrome-extension-content"
  | "chrome-extension-service-worker"
  | "react-native";

export interface EnvironmentInfo {
  type: Environment;
  hasFileSystem: boolean;
  hasCryptoModule: boolean;
  hasWebCrypto: boolean;
  hasIndexedDB: boolean;
  hasChromeStorage: boolean;
  hasWASMSupport: boolean;
  storageBackends: string[];
}

export function detectEnvironment(): EnvironmentInfo {
  // Chrome Extension Detection (must be first)
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
    // Check if it's a service worker (Manifest V3)
    if (
      typeof ServiceWorkerGlobalScope !== "undefined" &&
      self instanceof ServiceWorkerGlobalScope
    ) {
      return {
        type: "chrome-extension-service-worker",
        hasFileSystem: false,
        hasCryptoModule: false,
        hasWebCrypto: true,
        hasIndexedDB: false, // Service workers don't have IndexedDB
        hasChromeStorage: true,
        hasWASMSupport: true,
        storageBackends: ["chrome-storage"],
      };
    }

    // Check if it's a content script
    if (!chrome.storage) {
      return {
        type: "chrome-extension-content",
        hasFileSystem: false,
        hasCryptoModule: false,
        hasWebCrypto: true,
        hasIndexedDB: false,
        hasChromeStorage: false, // No direct access
        hasWASMSupport: true,
        storageBackends: ["message-passing"],
      };
    }

    // Background script/page
    return {
      type: "chrome-extension",
      hasFileSystem: false,
      hasCryptoModule: false,
      hasWebCrypto: true,
      hasIndexedDB: true,
      hasChromeStorage: true,
      hasWASMSupport: true,
      storageBackends: ["chrome-storage", "indexeddb"],
    };
  }

  // React Native Detection
  if (typeof navigator !== "undefined" && navigator.product === "ReactNative") {
    return {
      type: "react-native",
      hasFileSystem: false,
      hasCryptoModule: false,
      hasWebCrypto: false,
      hasIndexedDB: false,
      hasChromeStorage: false,
      hasWASMSupport: false,
      storageBackends: ["async-storage"],
    };
  }

  // Electron Detection
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.electron
  ) {
    if (process.type === "renderer") {
      return {
        type: "electron-renderer",
        hasFileSystem: false, // Need IPC for file access
        hasCryptoModule: false,
        hasWebCrypto: true,
        hasIndexedDB: true,
        hasChromeStorage: false,
        hasWASMSupport: true,
        storageBackends: ["indexeddb", "localstorage"],
      };
    }

    return {
      type: "electron-main",
      hasFileSystem: true,
      hasCryptoModule: true,
      hasWebCrypto: false,
      hasIndexedDB: false,
      hasChromeStorage: false,
      hasWASMSupport: true,
      storageBackends: ["filesystem"],
    };
  }

  // Node.js Detection
  if (
    typeof process !== "undefined" &&
    typeof require !== "undefined" &&
    typeof global !== "undefined" &&
    !process.browser
  ) {
    return {
      type: "node",
      hasFileSystem: true,
      hasCryptoModule: true,
      hasWebCrypto: false,
      hasIndexedDB: false,
      hasChromeStorage: false,
      hasWASMSupport: true,
      storageBackends: ["filesystem"],
    };
  }

  // Browser Detection (default)
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return {
      type: "browser",
      hasFileSystem: false,
      hasCryptoModule: false,
      hasWebCrypto: typeof crypto !== "undefined" && crypto.subtle,
      hasIndexedDB: typeof indexedDB !== "undefined",
      hasChromeStorage: false,
      hasWASMSupport: typeof WebAssembly !== "undefined",
      storageBackends: ["indexeddb", "localstorage"],
    };
  }

  // Fallback (unknown environment)
  return {
    type: "browser", // Default to browser-like
    hasFileSystem: false,
    hasCryptoModule: false,
    hasWebCrypto: false,
    hasIndexedDB: false,
    hasChromeStorage: false,
    hasWASMSupport: false,
    storageBackends: ["memory"],
  };
}

// Feature detection helpers
export function hasFeature(feature: keyof EnvironmentInfo): boolean {
  const env = detectEnvironment();
  return !!env[feature];
}

export function getStorageBackend(): string {
  const env = detectEnvironment();
  return env.storageBackends[0] || "memory";
}

export function getCryptoImplementation(): "node" | "web" | "polyfill" {
  const env = detectEnvironment();
  if (env.hasCryptoModule) return "node";
  if (env.hasWebCrypto) return "web";
  return "polyfill";
}
```

#### Task 1.4b: Test Environment Detection

```typescript
// tests/unit/utils/environment.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectEnvironment,
  hasFeature,
  getStorageBackend,
  getCryptoImplementation,
  type Environment,
} from "@/utils/environment";

describe("Environment Detection", () => {
  // Store original values
  let originalChrome: any;
  let originalProcess: any;
  let originalWindow: any;
  let originalNavigator: any;
  let originalGlobal: any;

  beforeEach(() => {
    // Store originals
    originalChrome = (global as any).chrome;
    originalProcess = (global as any).process;
    originalWindow = (global as any).window;
    originalNavigator = (global as any).navigator;
    originalGlobal = (global as any).global;

    // Clean slate
    delete (global as any).chrome;
    delete (global as any).process;
    delete (global as any).window;
    delete (global as any).navigator;
  });

  afterEach(() => {
    // Restore originals
    (global as any).chrome = originalChrome;
    (global as any).process = originalProcess;
    (global as any).window = originalWindow;
    (global as any).navigator = originalNavigator;
    (global as any).global = originalGlobal;
  });

  describe("Node.js environment", () => {
    it("should detect Node.js environment", () => {
      (global as any).process = {
        versions: { node: "16.0.0" },
        browser: false,
      };
      (global as any).require = () => {};
      (global as any).global = global;

      const env = detectEnvironment();

      expect(env.type).toBe("node");
      expect(env.hasFileSystem).toBe(true);
      expect(env.hasCryptoModule).toBe(true);
      expect(env.hasWebCrypto).toBe(false);
      expect(env.storageBackends).toContain("filesystem");
    });
  });

  describe("Browser environment", () => {
    it("should detect browser environment", () => {
      (global as any).window = {
        document: {},
      };
      (global as any).document = {};
      (global as any).crypto = {
        subtle: {},
      };
      (global as any).indexedDB = {};

      const env = detectEnvironment();

      expect(env.type).toBe("browser");
      expect(env.hasFileSystem).toBe(false);
      expect(env.hasCryptoModule).toBe(false);
      expect(env.hasWebCrypto).toBe(true);
      expect(env.hasIndexedDB).toBe(true);
      expect(env.storageBackends).toContain("indexeddb");
    });
  });

  describe("Chrome Extension environment", () => {
    it("should detect extension background script", () => {
      (global as any).chrome = {
        runtime: { id: "test-extension" },
        storage: {
          local: {},
          sync: {},
        },
      };

      const env = detectEnvironment();

      expect(env.type).toBe("chrome-extension");
      expect(env.hasChromeStorage).toBe(true);
      expect(env.hasFileSystem).toBe(false);
      expect(env.storageBackends).toContain("chrome-storage");
    });

    it("should detect extension content script", () => {
      (global as any).chrome = {
        runtime: { id: "test-extension" },
        // No storage access
      };

      const env = detectEnvironment();

      expect(env.type).toBe("chrome-extension-content");
      expect(env.hasChromeStorage).toBe(false);
      expect(env.storageBackends).toContain("message-passing");
    });

    it("should detect extension service worker", () => {
      (global as any).ServiceWorkerGlobalScope = class {};
      (global as any).self = new (global as any).ServiceWorkerGlobalScope();
      (global as any).chrome = {
        runtime: { id: "test-extension" },
        storage: { local: {} },
      };

      const env = detectEnvironment();

      expect(env.type).toBe("chrome-extension-service-worker");
      expect(env.hasIndexedDB).toBe(false); // Service workers don't have IDB
      expect(env.hasChromeStorage).toBe(true);
    });
  });

  describe("Electron environment", () => {
    it("should detect Electron main process", () => {
      (global as any).process = {
        versions: {
          node: "16.0.0",
          electron: "20.0.0",
        },
        type: "browser", // Main process
      };

      const env = detectEnvironment();

      expect(env.type).toBe("electron-main");
      expect(env.hasFileSystem).toBe(true);
      expect(env.hasCryptoModule).toBe(true);
      expect(env.storageBackends).toContain("filesystem");
    });

    it("should detect Electron renderer process", () => {
      (global as any).process = {
        versions: {
          node: "16.0.0",
          electron: "20.0.0",
        },
        type: "renderer",
      };

      const env = detectEnvironment();

      expect(env.type).toBe("electron-renderer");
      expect(env.hasFileSystem).toBe(false); // Need IPC
      expect(env.hasWebCrypto).toBe(true);
      expect(env.hasIndexedDB).toBe(true);
    });
  });

  describe("React Native environment", () => {
    it("should detect React Native", () => {
      (global as any).navigator = {
        product: "ReactNative",
      };

      const env = detectEnvironment();

      expect(env.type).toBe("react-native");
      expect(env.hasWASMSupport).toBe(false);
      expect(env.storageBackends).toContain("async-storage");
    });
  });

  describe("Feature detection helpers", () => {
    it("should check for specific features", () => {
      (global as any).process = {
        versions: { node: "16.0.0" },
      };
      (global as any).require = () => {};
      (global as any).global = global;

      expect(hasFeature("hasFileSystem")).toBe(true);
      expect(hasFeature("hasCryptoModule")).toBe(true);
      expect(hasFeature("hasWebCrypto")).toBe(false);
    });

    it("should get appropriate storage backend", () => {
      (global as any).chrome = {
        runtime: { id: "test" },
        storage: { local: {} },
      };

      expect(getStorageBackend()).toBe("chrome-storage");
    });

    it("should get crypto implementation", () => {
      // Node.js
      (global as any).process = { versions: { node: "16" } };
      (global as any).require = () => {};
      expect(getCryptoImplementation()).toBe("node");

      // Browser
      delete (global as any).process;
      (global as any).window = {};
      (global as any).crypto = { subtle: {} };
      expect(getCryptoImplementation()).toBe("web");

      // Neither
      delete (global as any).crypto;
      expect(getCryptoImplementation()).toBe("polyfill");
    });
  });
});
```

#### Task 1.5: Create WASM Mock Factory

```typescript
// tests/helpers/wasm-mocks.ts
import { vi } from "vitest";

export function mockWASMModules() {
  // Mock WalletCore
  vi.mock("@/wasm/wallet-core", () => ({
    WalletCore: {
      load: vi.fn().mockResolvedValue({
        deriveAddress: vi.fn().mockImplementation((chain, publicKey) => {
          // Return fixture-based addresses
          return getMockAddress(chain, publicKey);
        }),
        getPublicKey: vi.fn().mockImplementation((privKey) => {
          return getMockPublicKey(privKey);
        }),
      }),
    },
  }));

  // Mock DKLS (ECDSA)
  vi.mock("@/wasm/dkls", () => ({
    DKLS: {
      load: vi.fn().mockResolvedValue({
        keygen: vi.fn().mockResolvedValue({
          localShare: "mock_ecdsa_share",
          publicKey: "mock_ecdsa_pubkey",
        }),
        sign: vi.fn().mockResolvedValue({
          signature: "mock_ecdsa_signature",
          r: "mock_r",
          s: "mock_s",
          v: 27,
        }),
      }),
    },
  }));

  // Mock Schnorr (EdDSA)
  vi.mock("@/wasm/schnorr", () => ({
    Schnorr: {
      load: vi.fn().mockResolvedValue({
        keygen: vi.fn().mockResolvedValue({
          localShare: "mock_eddsa_share",
          publicKey: "mock_eddsa_pubkey",
        }),
        sign: vi.fn().mockResolvedValue({
          signature: "mock_eddsa_signature",
        }),
      }),
    },
  }));
}

function getMockAddress(chain: string, publicKey: string): string {
  // Load from fixtures
  const fixtures = require(`@fixtures/chains/${chain}/addresses.json`);
  return fixtures.valid[0]?.address || `mock_${chain}_address`;
}

function getMockPublicKey(privKey: string): string {
  // Return deterministic public key for testing
  return `mock_pubkey_${privKey.slice(0, 8)}`;
}
```

#### Task 1.6: Create Server Mock Factory

```typescript
// tests/helpers/server-mocks.ts
import { vi } from "vitest";
import { rest } from "msw";
import { setupServer } from "msw/node";

const API_BASE = "https://test.api.vultisig.com";

export const mockServer = setupServer(
  // Fast Vault Creation
  rest.post(`${API_BASE}/vault/create`, (req, res, ctx) => {
    return res(
      ctx.json({
        session_id: "mock_session_123",
        hex_encryption_key: "mock_hex_key",
        service_id: "mock_service_id",
      }),
    );
  }),

  // Email Verification
  rest.get(`${API_BASE}/vault/verify/:publicKey/:code`, (req, res, ctx) => {
    return res(
      ctx.json({
        status: "verified",
        publicKey: req.params.publicKey,
      }),
    );
  }),

  // Fast Signing
  rest.post(`${API_BASE}/vault/sign`, (req, res, ctx) => {
    return res(
      ctx.json({
        session_id: "mock_sign_session",
        service_id: "mock_service_id",
      }),
    );
  }),

  // Message Relay
  rest.post(`${API_BASE}/router/:sessionId`, (req, res, ctx) => {
    return res(ctx.status(201));
  }),

  rest.get(`${API_BASE}/router/:sessionId`, (req, res, ctx) => {
    return res(ctx.json(["participant_1", "participant_2"]));
  }),
);

export function setupServerMocks() {
  beforeAll(() => mockServer.listen({ onUnhandledRequest: "warn" }));
  afterEach(() => mockServer.resetHandlers());
  afterAll(() => mockServer.close());
}
```

## Week 2: Initial Testing Implementation

### Day 6-7: Utility Function Tests

#### Task 1.7: Test Validation Utilities

```typescript
// tests/unit/utils/validation.test.ts
import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  isValidVaultName,
  isValidPassword,
  validateChainName,
} from "@/utils/validation";

describe("Validation Utilities", () => {
  describe("isValidEmail", () => {
    it("should validate correct email formats", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("test.user+tag@domain.co.uk")).toBe(true);
    });

    it("should reject invalid email formats", () => {
      expect(isValidEmail("invalid")).toBe(false);
      expect(isValidEmail("@domain.com")).toBe(false);
      expect(isValidEmail("user@")).toBe(false);
    });
  });

  describe("isValidVaultName", () => {
    it("should validate vault names", () => {
      expect(isValidVaultName("MyVault")).toBe(true);
      expect(isValidVaultName("Vault-123")).toBe(true);
    });

    it("should reject invalid vault names", () => {
      expect(isValidVaultName("")).toBe(false);
      expect(isValidVaultName("a".repeat(101))).toBe(false);
      expect(isValidVaultName("Vault/\\<>")).toBe(false);
    });
  });

  describe("validateChainName", () => {
    it("should validate supported chain names", () => {
      expect(validateChainName("bitcoin")).toBe(true);
      expect(validateChainName("ethereum")).toBe(true);
      expect(validateChainName("solana")).toBe(true);
    });

    it("should reject unsupported chains", () => {
      expect(validateChainName("unsupported")).toBe(false);
      expect(validateChainName("")).toBe(false);
    });
  });
});
```

#### Task 1.8: Test Crypto Utilities

```typescript
// tests/unit/utils/crypto.test.ts
import { describe, it, expect } from "vitest";
import {
  generateSessionId,
  encryptVault,
  decryptVault,
  hashPassword,
} from "@/utils/crypto";

describe("Crypto Utilities", () => {
  describe("generateSessionId", () => {
    it("should generate unique session IDs", () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBe(32); // Assuming 32 char IDs
    });
  });

  describe("vault encryption/decryption", () => {
    it("should encrypt and decrypt vault data", () => {
      const originalData = { test: "data", nested: { value: 123 } };
      const password = "TestPassword123!";

      const encrypted = encryptVault(originalData, password);
      expect(encrypted).not.toBe(originalData);

      const decrypted = decryptVault(encrypted, password);
      expect(decrypted).toEqual(originalData);
    });

    it("should fail decryption with wrong password", () => {
      const data = { test: "data" };
      const encrypted = encryptVault(data, "correct");

      expect(() => decryptVault(encrypted, "wrong")).toThrow();
    });
  });
});
```

### Day 8-9: Basic Component Tests

#### Task 1.9: VaultError Tests

```typescript
// tests/unit/vault/VaultError.test.ts
import { describe, it, expect } from "vitest";
import { VaultError, VaultErrorCode } from "@/vault/VaultError";

describe("VaultError", () => {
  it("should create error with correct code and message", () => {
    const error = new VaultError(
      VaultErrorCode.VAULT_NOT_FOUND,
      "Vault with ID xyz not found",
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(VaultError);
    expect(error.code).toBe(VaultErrorCode.VAULT_NOT_FOUND);
    expect(error.message).toBe("Vault with ID xyz not found");
  });

  it("should wrap underlying errors", () => {
    const cause = new Error("Network error");
    const error = new VaultError(
      VaultErrorCode.SERVER_ERROR,
      "Failed to connect to server",
      cause,
    );

    expect(error.cause).toBe(cause);
  });

  it("should serialize to JSON", () => {
    const error = new VaultError(
      VaultErrorCode.INVALID_PASSWORD,
      "Invalid password",
    );

    const json = JSON.stringify(error);
    const parsed = JSON.parse(json);

    expect(parsed.code).toBe(VaultErrorCode.INVALID_PASSWORD);
    expect(parsed.message).toBe("Invalid password");
  });
});
```

#### Task 1.10: ChainManager Tests

```typescript
// tests/unit/chains/ChainManager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { ChainManager } from "@/ChainManager";
import { loadChainFixtures } from "@helpers/fixture-loaders";

describe("ChainManager", () => {
  let chainManager: ChainManager;

  beforeEach(() => {
    chainManager = new ChainManager();
  });

  describe("getSupportedChains", () => {
    it("should return all supported chains", () => {
      const chains = chainManager.getSupportedChains();

      expect(chains).toContain("bitcoin");
      expect(chains).toContain("ethereum");
      expect(chains).toContain("solana");
      expect(chains.length).toBeGreaterThanOrEqual(30);
    });
  });

  describe("getDefaultChains", () => {
    it("should return default chains", () => {
      const defaults = chainManager.getDefaultChains();

      expect(defaults).toContain("bitcoin");
      expect(defaults).toContain("ethereum");
      expect(defaults).toContain("solana");
      expect(defaults).toContain("thorchain");
      expect(defaults).toContain("ripple");
    });
  });

  describe("validateChain", () => {
    it("should validate supported chains", () => {
      expect(chainManager.validateChain("bitcoin")).toBe(true);
      expect(chainManager.validateChain("invalid")).toBe(false);
    });
  });

  describe("getChainConfig", () => {
    it("should return chain configuration", () => {
      const btcConfig = chainManager.getChainConfig("bitcoin");

      expect(btcConfig).toBeDefined();
      expect(btcConfig.name).toBe("bitcoin");
      expect(btcConfig.symbol).toBe("BTC");
      expect(btcConfig.decimals).toBe(8);
    });
  });
});
```

### Day 10: CI/CD Setup

#### Task 1.11: GitHub Actions Configuration

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  test-unit:
    name: Unit Tests
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Generate coverage report
        run: npm run test:coverage

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella

      - name: Archive coverage report
        uses: actions/upload-artifact@v3
        with:
          name: coverage-report
          path: coverage/

  validate-fixtures:
    name: Validate Chain Fixtures
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Validate fixture structure
        run: npm run validate:fixtures

      - name: Check fixture completeness
        run: npm run check:fixture-coverage

  lint-and-type:
    name: Lint and Type Check
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npm run type-check
```

#### Task 1.12: Pre-commit Hooks Setup

```json
// package.json additions
{
  "scripts": {
    "prepare": "husky install",
    "pre-commit": "lint-staged",
    "test:unit": "vitest run tests/unit",
    "test:coverage": "vitest run --coverage",
    "validate:fixtures": "node tests/scripts/validate-fixtures.js",
    "check:fixture-coverage": "node tests/scripts/check-fixture-coverage.js"
  },
  "lint-staged": {
    "*.ts": ["eslint --fix", "vitest related --run"],
    "tests/fixtures/**/*.json": ["node tests/scripts/validate-fixtures.js"]
  },
  "devDependencies": {
    "husky": "^8.0.0",
    "lint-staged": "^13.0.0"
  }
}
```

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npm run pre-commit
```

## Deliverables Checklist

### Infrastructure ✓

- [ ] Vitest configuration with coverage thresholds
- [ ] Test setup file with global mocks
- [ ] Helper utilities for testing
- [ ] Alias configuration for clean imports

### Chain Fixtures ✓

- [ ] Fixture directory structure for 30+ chains
- [ ] Fixture generator script
- [ ] Tier 1 chains fully populated (BTC, ETH, SOL, THOR, XRP)
- [ ] Fixture validation script

### Mock Strategies ✓

- [ ] WASM module mocks
- [ ] Server API mocks (MSW)
- [ ] Blockchain RPC mocks
- [ ] File system mocks

### Initial Tests ✓

- [ ] Validation utility tests
- [ ] Crypto utility tests
- [ ] VaultError tests
- [ ] ChainManager tests
- [ ] 30% code coverage achieved

### CI/CD ✓

- [ ] GitHub Actions workflow
- [ ] Coverage reporting (Codecov)
- [ ] Pre-commit hooks
- [ ] Automated fixture validation

## Success Metrics

| Metric              | Target      | Actual | Status |
| ------------------- | ----------- | ------ | ------ |
| Code Coverage       | 30%         | -      | 🔄     |
| Test Execution Time | <30s        | -      | 🔄     |
| Fixture Coverage    | 100% Tier 1 | -      | 🔄     |
| CI Pipeline Setup   | Complete    | -      | 🔄     |
| Mock Framework      | Complete    | -      | 🔄     |

## Common Issues & Solutions

### Issue 1: WASM Module Loading Errors

**Solution**: Ensure mocks are properly initialized in setup.ts before any tests run.

### Issue 2: Fixture Data Inconsistency

**Solution**: Use fixture validation script to ensure all chains have required fields.

### Issue 3: Test Timeout Issues

**Solution**: Increase timeout in vitest.config.ts for integration tests.

### Issue 4: Coverage Not Meeting Threshold

**Solution**: Focus on utility functions and error handling paths first.

## Next Steps (Phase 2 Preview)

With the foundation established, Phase 2 will focus on:

1. Core component testing (Vault, VaultManager)
2. Service layer testing (Cache, FastSigning)
3. Adapter pattern testing
4. Achieving 50% code coverage

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [MSW (Mock Service Worker)](https://mswjs.io/)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Codecov Integration](https://docs.codecov.com/docs)

---

_Phase 1 establishes the critical testing foundation. Successful completion enables rapid test development in subsequent phases._
