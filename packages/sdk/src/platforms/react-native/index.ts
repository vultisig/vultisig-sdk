/**
 * React Native platform entry point
 *
 * Selective exports — only RN-compatible APIs are included.
 * Chain implementations that depend on Node.js built-ins are excluded.
 *
 * Uses:
 * - @vultisig/expo-mpc for MPC (DKLS/Schnorr) via native modules
 * - @vultisig/expo-wallet-core for WalletCore via native modules
 * - @react-native-async-storage/async-storage for vault storage
 *
 * The Rollup alias plugin redirects @lib/dkls/vs_wasm and @lib/schnorr/vs_schnorr_wasm
 * to the adapter modules in this directory.
 */

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { ReactNativeCrypto } from './crypto'
import { ReactNativeStorage } from './storage'
import { createNativeWalletCore } from './wallet-core-adapter'

// Configure crypto (validation is deferred — app must set up polyfills before using SDK)
configureCrypto(new ReactNativeCrypto())

// Configure default storage
configureDefaultStorage(() => new ReactNativeStorage())

// Configure WalletCore — uses native TrustWallet via @vultisig/expo-wallet-core
let walletCoreInstance: any = null
configureWasm(async () => {
  if (!walletCoreInstance) {
    walletCoreInstance = createNativeWalletCore()
  }
  return walletCoreInstance
})

// ============================================================================
// RN-safe exports
// Node.js crypto deps are replaced by Rollup aliases:
//   encryptWithAesGcm → polyfills/encryptWithAesGcm (@noble/ciphers)
//   decryptWithAesGcm → polyfills/decryptWithAesGcm (@noble/ciphers)
//   getMessageHash → polyfills/getMessageHash (pure JS MD5)
// ============================================================================

// Chain enum and types
export { Chain } from '@core/chain/Chain'

// Seedphrase (import directly — barrel re-exports ChainDiscoveryService which pulls in chain code)
export { SEEDPHRASE_WORD_COUNTS } from '../../seedphrase/types'
export { validateSeedphrase } from '../../seedphrase/SeedphraseValidator'

// Storage
export { MemoryStorage } from '../../storage'

// MPC keysign — the full signing flow (relay, message exchange, TX compilation)
export { keysign } from '@core/mpc/keysign/index'

// MPC relay message helpers
export {
  toMpcServerMessage,
  fromMpcServerMessage,
} from '@core/mpc/message/server'

// MPC relay communication
export { sendMpcRelayMessage } from '@core/mpc/message/relay/send'
export { getMpcRelayMessages } from '@core/mpc/message/relay/get'
export { deleteMpcRelayMessage } from '@core/mpc/message/relay/delete'

// TX compilation
export { compileTx } from '@core/chain/tx/compile/compileTx'

// Signature generation
export { generateSignature } from '@core/chain/tx/signature/generateSignature'

// Pre-signing hashes
export { getPreSigningHashes } from '@core/chain/tx/preSigningHashes/index'

// WalletCore adapter
export { createNativeWalletCore } from './wallet-core-adapter'

// Platform
export { ReactNativeCrypto, ReactNativeStorage }
export { ReactNativeStorage as Storage }
