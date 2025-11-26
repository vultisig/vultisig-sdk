/**
 * React Native platform entry point
 *
 * This bundle includes only React Native-specific implementations:
 * - ReactNativeStorage (AsyncStorage)
 * - ReactNativeWasmLoader (custom loading)
 * - ReactNativeCrypto (expo-crypto or polyfills)
 * - ReactNativePolyfills (Buffer, process, etc.)
 *
 * All Node.js/Browser code is excluded at build time.
 *
 * Note: React Native requires additional setup:
 * - Install @react-native-async-storage/async-storage
 * - Set up crypto polyfills (expo-crypto or react-native-crypto)
 * - Configure WASM loading
 * - Install buffer and other polyfills
 */

// Platform-specific implementations
// Configure global storage to use React Native implementation
import { GlobalStorage } from "../../storage/GlobalStorage";
import { ReactNativeCrypto } from "./crypto";
import { ReactNativePolyfills } from "./polyfills";
import { ReactNativeStorage } from "./storage";
import { ReactNativeWasmLoader } from "./wasm";
GlobalStorage.configure(new ReactNativeStorage());

// Configure global crypto to use React Native implementation
import { configureCrypto } from "../../crypto";
configureCrypto(new ReactNativeCrypto());

// Configure WASM to use React Native loader
import { WasmManager } from "../../wasm";
const wasmLoader = new ReactNativeWasmLoader();
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
  ReactNativeCrypto,
  ReactNativePolyfills,
  ReactNativeStorage,
  ReactNativeWasmLoader,
};
