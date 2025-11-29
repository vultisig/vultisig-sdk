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
 *
 * Usage:
 * ```typescript
 * import { Vultisig, ReactNativeStorage } from '@vultisig/sdk/react-native'
 *
 * const sdk = new Vultisig({
 *   storage: new ReactNativeStorage()
 * })
 * ```
 */

// Platform-specific implementations
// Configure global crypto to use React Native implementation
import { configureCrypto } from '../../crypto'
import { ReactNativeCrypto } from './crypto'
import { ReactNativePolyfills } from './polyfills'
import { ReactNativeStorage } from './storage'
import { ReactNativeWasmLoader } from './wasm'
configureCrypto(new ReactNativeCrypto())

// Configure SharedWasmRuntime to use React Native loader (process-wide singleton)
import { SharedWasmRuntime } from '../../context/SharedWasmRuntime'
const wasmLoader = new ReactNativeWasmLoader()
SharedWasmRuntime.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { ReactNativeCrypto, ReactNativePolyfills, ReactNativeStorage, ReactNativeWasmLoader }
