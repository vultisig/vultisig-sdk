# Environment-Specific Testing Guide for Vultisig SDK

## Overview

The Vultisig SDK is designed to work across multiple JavaScript/TypeScript environments, each with unique capabilities and constraints. This guide provides comprehensive information for testing the SDK in each supported environment.

## Supported Environments

1. **Node.js** - Server-side JavaScript runtime
2. **Browser** - Web browsers (Chrome, Firefox, Safari, Edge)
3. **Electron Main Process** - Desktop app main process
4. **Electron Renderer Process** - Desktop app renderer windows
5. **Chrome Extension** - Browser extension environment
6. **React Native** - Mobile app framework

## Environment Detection

The SDK uses feature detection rather than hard-coded environment checks to ensure maximum compatibility.

```typescript
// src/utils/environment.ts
import {
  detectEnvironment,
  hasFeature,
  getCryptoImplementation,
} from "@/utils/environment";

const env = detectEnvironment();
console.log(`Running in: ${env.type}`);
console.log(`Has file system: ${env.hasFileSystem}`);
console.log(`Crypto implementation: ${getCryptoImplementation()}`);
```

## Environment-Specific Code Paths

### 1. File Operations

Different environments handle file operations differently. The SDK must adapt to each environment's capabilities.

#### Node.js

```typescript
// Direct file system access
import fs from "fs/promises";

async function exportVault(vault: Vault, path: string) {
  const data = JSON.stringify(vault);
  await fs.writeFile(path, data, "utf-8");
}

async function importVault(path: string): Promise<Vault> {
  const data = await fs.readFile(path, "utf-8");
  return JSON.parse(data);
}
```

#### Browser

```typescript
// FileReader API for imports, download for exports
async function exportVault(vault: Vault) {
  const blob = new Blob([JSON.stringify(vault)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "vault.json";
  a.click();

  URL.revokeObjectURL(url);
}

async function importVault(file: File): Promise<Vault> {
  const text = await file.text();
  return JSON.parse(text);
}
```

#### Chrome Extension

```typescript
// Chrome downloads API for export, no direct file import
async function exportVault(vault: Vault) {
  const blob = new Blob([JSON.stringify(vault)], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  chrome.downloads.download({
    url: url,
    filename: "vault.json",
    saveAs: true,
  });
}

// Import handled via file input in extension popup/options page
```

#### React Native

```typescript
// React Native file system
import RNFS from "react-native-fs";

async function exportVault(vault: Vault) {
  const path = `${RNFS.DocumentDirectoryPath}/vault.json`;
  await RNFS.writeFile(path, JSON.stringify(vault), "utf8");
}

async function importVault(path: string): Promise<Vault> {
  const data = await RNFS.readFile(path, "utf8");
  return JSON.parse(data);
}
```

### 2. Cryptographic Operations

Different crypto APIs across environments require abstraction.

#### Node.js

```typescript
import crypto from "crypto";

function encrypt(data: string, password: string): Buffer {
  const cipher = crypto.createCipher("aes-256-gcm", password);
  const encrypted = Buffer.concat([
    cipher.update(data, "utf8"),
    cipher.final(),
  ]);
  return encrypted;
}
```

#### Browser/Chrome Extension

```typescript
async function encrypt(data: string, password: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  return crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, dataBuffer);
}
```

#### React Native

```typescript
// Requires polyfill or native module
import CryptoJS from "crypto-js";

function encrypt(data: string, password: string): string {
  return CryptoJS.AES.encrypt(data, password).toString();
}
```

### 3. Storage Mechanisms

Each environment has different storage capabilities.

#### Node.js

```typescript
class NodeStorage {
  private basePath: string;

  async set(key: string, value: any): Promise<void> {
    const filePath = path.join(this.basePath, `${key}.json`);
    await fs.writeFile(filePath, JSON.stringify(value));
  }

  async get(key: string): Promise<any> {
    const filePath = path.join(this.basePath, `${key}.json`);
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  }
}
```

#### Browser

```typescript
class BrowserStorage {
  private db: IDBDatabase;

  async set(key: string, value: any): Promise<void> {
    const transaction = this.db.transaction(["vaults"], "readwrite");
    const store = transaction.objectStore("vaults");
    await store.put(value, key);
  }

  async get(key: string): Promise<any> {
    const transaction = this.db.transaction(["vaults"], "readonly");
    const store = transaction.objectStore("vaults");
    return store.get(key);
  }
}
```

#### Chrome Extension

```typescript
class ChromeExtensionStorage {
  async set(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result[key]);
        }
      });
    });
  }
}
```

#### React Native

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

class ReactNativeStorage {
  async set(key: string, value: any): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  }

  async get(key: string): Promise<any> {
    const data = await AsyncStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  }
}
```

### 4. WASM Module Loading

WebAssembly loading varies by environment.

#### Node.js

```typescript
import fs from "fs";
import path from "path";

async function loadWASM(moduleName: string): Promise<WebAssembly.Module> {
  const wasmPath = path.join(__dirname, `${moduleName}.wasm`);
  const wasmBuffer = fs.readFileSync(wasmPath);
  return WebAssembly.compile(wasmBuffer);
}
```

#### Browser

```typescript
async function loadWASM(moduleName: string): Promise<WebAssembly.Module> {
  const response = await fetch(`/wasm/${moduleName}.wasm`);
  const wasmBuffer = await response.arrayBuffer();
  return WebAssembly.compile(wasmBuffer);
}
```

#### Chrome Extension

```typescript
async function loadWASM(moduleName: string): Promise<WebAssembly.Module> {
  // May face CSP restrictions in Manifest V3
  const wasmUrl = chrome.runtime.getURL(`wasm/${moduleName}.wasm`);

  try {
    // Try streaming compilation first
    const response = await fetch(wasmUrl);
    return await WebAssembly.compileStreaming(response);
  } catch (e) {
    // Fall back to non-streaming if CSP blocks
    const response = await fetch(wasmUrl);
    const buffer = await response.arrayBuffer();
    return WebAssembly.compile(buffer);
  }
}
```

#### React Native

```typescript
// React Native doesn't support WASM directly
// Must use JavaScript fallback or bridge to native code
async function loadWASM(moduleName: string): Promise<any> {
  // Use JavaScript implementation or native module
  throw new Error("WASM not supported in React Native - use native module");
}
```

## Testing Setup for Each Environment

### Node.js Testing

```json
// vitest.config.node.ts
{
  "test": {
    "environment": "node",
    "setupFiles": ["./tests/setup.node.ts"]
  }
}
```

```typescript
// tests/setup.node.ts
import { TextEncoder, TextDecoder } from "util";

// Polyfills for Node.js
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
```

### Browser Testing

```json
// vitest.config.browser.ts
{
  "test": {
    "environment": "jsdom",
    "setupFiles": ["./tests/setup.browser.ts"]
  }
}
```

```typescript
// tests/setup.browser.ts
// Mock browser-specific APIs
global.indexedDB = new FakeIndexedDB();
global.crypto = {
  subtle: mockWebCrypto(),
  getRandomValues: (arr) => {
    // Implementation
  },
};
```

### Chrome Extension Testing

```typescript
// tests/setup.chrome-extension.ts
global.chrome = {
  runtime: {
    id: "test-extension-id",
    getManifest: () => ({ manifest_version: 3 }),
  },
  storage: {
    local: mockChromeStorage(),
    sync: mockChromeStorage(),
  },
  downloads: {
    download: vi.fn(),
  },
};
```

### React Native Testing

```typescript
// tests/setup.react-native.ts
jest.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    Version: 14,
  },
  AsyncStorage: mockAsyncStorage(),
}));

jest.mock("react-native-fs", () => ({
  DocumentDirectoryPath: "/mock/documents",
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));
```

## Environment-Specific Test Suites

### Test Organization

```
tests/
├── unit/                    # Environment-agnostic tests
│   └── core/               # Core logic tests
├── integration/
│   ├── node/               # Node.js specific tests
│   ├── browser/            # Browser specific tests
│   ├── chrome-extension/   # Extension specific tests
│   ├── electron-main/      # Electron main tests
│   ├── electron-renderer/  # Electron renderer tests
│   └── react-native/       # React Native tests
└── e2e/
    └── cross-environment/   # Tests that verify cross-env compatibility
```

### Running Environment-Specific Tests

```bash
# Run all tests
npm test

# Run Node.js tests only
npm test:node

# Run browser tests only
npm test:browser

# Run Chrome Extension tests only
npm test:chrome-extension

# Run React Native tests only
npm test:react-native
```

### Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest run",
    "test:node": "vitest run --config vitest.config.node.ts",
    "test:browser": "vitest run --config vitest.config.browser.ts",
    "test:chrome-extension": "vitest run --config vitest.config.chrome.ts",
    "test:react-native": "jest --config jest.config.rn.js"
  }
}
```

## Common Testing Patterns

### Pattern 1: Feature Detection Over Environment Checking

```typescript
// ❌ Bad - Hard-coded environment check
if (process.env.NODE_ENV === "node") {
  const fs = require("fs");
  // Node.js specific code
}

// ✅ Good - Feature detection
if (typeof require !== "undefined" && require.resolve) {
  const fs = require("fs");
  // Node.js specific code
}
```

### Pattern 2: Abstract Environment-Specific Code

```typescript
// storage/StorageFactory.ts
export function createStorage(): Storage {
  const env = detectEnvironment();

  switch (env.type) {
    case "node":
      return new NodeStorage();
    case "browser":
      return new BrowserStorage();
    case "chrome-extension":
      return new ChromeExtensionStorage();
    case "react-native":
      return new ReactNativeStorage();
    default:
      return new MemoryStorage();
  }
}
```

### Pattern 3: Progressive Enhancement

```typescript
class VaultExporter {
  async export(vault: Vault, filename: string) {
    const data = JSON.stringify(vault);

    // Try best method first, fall back gracefully
    if (hasFeature("hasFileSystem")) {
      // Direct file write
      await fs.writeFile(filename, data);
    } else if (hasFeature("hasChromeStorage")) {
      // Chrome downloads API
      await this.chromeDownload(data, filename);
    } else if (typeof document !== "undefined") {
      // Browser download
      this.browserDownload(data, filename);
    } else {
      // Return data for manual handling
      return data;
    }
  }
}
```

## Environment-Specific Limitations

### Chrome Extension (Manifest V3)

1. **No remote code execution** - All code must be bundled
2. **CSP restrictions** - May affect WASM loading
3. **Service worker lifecycle** - Background script can be terminated
4. **Storage limits** - chrome.storage.sync limited to 100KB
5. **No direct file access** - Must use chrome.downloads API

### React Native

1. **No WASM support** - Must use native modules or JS fallbacks
2. **Different crypto libraries** - No built-in crypto module
3. **Platform differences** - iOS vs Android capabilities
4. **Storage limits** - AsyncStorage has size limits
5. **No direct file access** - Must use react-native-fs

### Browser

1. **No file system access** - Only FileReader API
2. **CORS restrictions** - Network requests limited
3. **Storage quotas** - IndexedDB has limits
4. **No native modules** - Pure JavaScript only
5. **Security restrictions** - Various API limitations

### Electron Renderer

1. **Context isolation** - Limited access to Node.js APIs
2. **IPC required** - Must communicate with main process
3. **Security restrictions** - When contextIsolation is enabled
4. **Mixed environment** - Both browser and Node.js features

## Testing Checklist

For each environment, ensure:

- [ ] Environment detection works correctly
- [ ] Storage operations function properly
- [ ] File import/export works (if supported)
- [ ] Crypto operations use correct API
- [ ] WASM modules load (if supported)
- [ ] Network requests function
- [ ] Error handling is appropriate
- [ ] Memory management is efficient
- [ ] Performance meets requirements
- [ ] Security constraints are respected

## Debugging Environment Issues

### Common Issues and Solutions

1. **"crypto is not defined"**
   - Ensure proper polyfill for environment
   - Use feature detection before accessing

2. **"fs is not defined"**
   - Browser environment detected as Node.js
   - Check environment detection logic

3. **"chrome is not defined"**
   - Extension APIs accessed outside extension
   - Add proper environment guards

4. **WASM loading fails**
   - Check CSP headers
   - Verify WASM file path
   - Ensure proper MIME type

5. **Storage quota exceeded**
   - Implement storage cleanup
   - Use appropriate storage mechanism
   - Handle quota errors gracefully

## Performance Considerations

### Environment-Specific Optimizations

#### Node.js

- Use native crypto for best performance
- Stream large files instead of loading to memory
- Use worker threads for CPU-intensive operations

#### Browser

- Use Web Workers for heavy computations
- Implement progressive loading
- Cache in IndexedDB for offline support

#### Chrome Extension

- Minimize storage operations
- Use chrome.storage.local for large data
- Implement efficient message passing

#### React Native

- Use native modules for performance-critical code
- Implement lazy loading
- Optimize bundle size

## Continuous Integration

### Multi-Environment CI Pipeline

```yaml
# .github/workflows/test-all-environments.yml
name: Test All Environments

on: [push, pull_request]

jobs:
  test-node:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [16, 18, 20]
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run test:node

  test-browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:browser

  test-chrome-extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:chrome-extension

  test-react-native:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test:react-native
```

## Conclusion

Testing the Vultisig SDK across multiple environments requires careful attention to environment-specific capabilities and limitations. By using feature detection, proper abstraction, and comprehensive testing, we ensure the SDK works reliably in all supported environments.

Remember:

1. **Test where code differs** - Don't duplicate tests for identical logic
2. **Start simple** - Begin with Node.js, then add complexity
3. **Use feature detection** - Avoid hard-coded environment checks
4. **Abstract differences** - Hide environment specifics behind interfaces
5. **Test progressively** - Ensure graceful degradation

---

_This guide is a living document and should be updated as new environments are supported or new patterns emerge._
