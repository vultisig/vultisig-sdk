/**
 * Electron Renderer process entry point
 *
 * This bundle includes Electron Renderer-specific implementations:
 * - ElectronRendererStorage (IndexedDB/localStorage, same as browser)
 * - ElectronRendererWasmLoader (fetch, same as browser)
 * - ElectronRendererCrypto (Web Crypto API, same as browser)
 * - ElectronRendererPolyfills (Buffer/process, same as browser)
 *
 * All Node.js/main process code is excluded at build time.
 */

// Platform-specific implementations (re-exported from browser)
// Configure global storage to use Electron Renderer implementation
import { GlobalStorage } from "../../storage/GlobalStorage";
import { BrowserPolyfills as ElectronRendererPolyfills } from "../browser/polyfills";
import { BrowserStorage as ElectronRendererStorage } from "../browser/storage";
import { BrowserWasmLoader as ElectronRendererWasmLoader } from "../browser/wasm";
import { ElectronRendererCrypto } from "./crypto";
GlobalStorage.configure(new ElectronRendererStorage());

// Configure global crypto to use Electron Renderer implementation
import { configureCrypto } from "../../crypto";
configureCrypto(new ElectronRendererCrypto());

// Configure WASM to use Electron Renderer loader
import { WasmManager } from "../../wasm";
const wasmLoader = new ElectronRendererWasmLoader();
WasmManager.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
});

// Re-export entire public API
export * from "../../index";

// Export platform-specific implementations for advanced users
export {
  ElectronRendererCrypto,
  ElectronRendererPolyfills,
  ElectronRendererStorage,
  ElectronRendererWasmLoader,
};
