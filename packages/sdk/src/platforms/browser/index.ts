/**
 * Browser platform entry point
 *
 * This bundle includes only browser-specific implementations:
 * - BrowserStorage (IndexedDB/localStorage)
 * - BrowserWasmLoader (fetch)
 * - BrowserCrypto (Web Crypto API)
 * - BrowserPolyfills (Buffer, process)
 *
 * All Node.js/React Native code is excluded at build time.
 */

// Platform-specific implementations
// Configure global storage to use Browser implementation
import { GlobalStorage } from "../../storage/GlobalStorage";
import { BrowserCrypto } from "./crypto";
import { BrowserPolyfills } from "./polyfills";
import { BrowserStorage } from "./storage";
import { BrowserWasmLoader } from "./wasm";
GlobalStorage.configure(new BrowserStorage());

// Configure global crypto to use Browser implementation
import { configureCrypto } from "../../crypto";
configureCrypto(new BrowserCrypto());

// Configure WASM to use Browser loader
import { WasmManager } from "../../wasm";
const wasmLoader = new BrowserWasmLoader();
WasmManager.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
});

// Re-export entire public API
export * from "../../index";

// Export platform-specific implementations for advanced users
export { BrowserCrypto, BrowserPolyfills, BrowserStorage, BrowserWasmLoader };
