/**
 * React Native platform entry point
 *
 * Registers the native MPC engine, native WalletCore, RN crypto, and RN storage.
 * Exports RN-compatible SDK APIs.
 */

// Buffer polyfill MUST happen before any SDK module graph import. Several
// bundled deps read `globalThis.Buffer` at module-init (e.g. @solana/web3.js,
// @noble/*, @polkadot/*). Consumers often polyfill Buffer in App.tsx, but
// because ES module imports are hoisted, the SDK's module bodies can evaluate
// before App.tsx's polyfill runs. Polyfilling here guarantees ordering.
import { Buffer as _Buffer } from 'buffer'
if (typeof globalThis !== 'undefined' && !(globalThis as { Buffer?: unknown }).Buffer) {
  ;(globalThis as { Buffer?: unknown }).Buffer = _Buffer
}

import { NativeMpcEngine } from '@vultisig/mpc-native'
import { configureMpc } from '@vultisig/mpc-types'
import { NativeWalletCore } from '@vultisig/walletcore-native'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { ReactNativeCrypto } from './crypto'
import { ReactNativeStorage } from './storage'

// Register native MPC engine
configureMpc(new NativeMpcEngine())

// Register native WalletCore as the WalletCore provider
configureWasm(async () => NativeWalletCore.getInstance())

// Register RN crypto (validates globalThis.crypto polyfill on first use)
configureCrypto(new ReactNativeCrypto())

// Register AsyncStorage-backed default storage
configureDefaultStorage(() => new ReactNativeStorage())

// Chain enum and types
export { Chain } from '@vultisig/core-chain/Chain'

// WalletCore type compatible with both @trustwallet/wallet-core and @vultisig/walletcore-native
export type { WalletCoreLike } from '@vultisig/walletcore-native'

// Address derivation and chain utilities
// RN wrappers accept WalletCoreLike from @vultisig/walletcore-native
// so consumers don't need to cast to @trustwallet/wallet-core's WalletCore.
export { deriveAddress, getCoinType, getPublicKey, isValidAddress } from './chainHelpers'

// MPC keysign (uses MpcEngine — no direct WASM imports)
export { keysign } from '@vultisig/core-mpc/keysign'

// Seedphrase validation (uses @scure/bip39, RN-compatible)
export { validateSeedphrase } from '../../seedphrase/SeedphraseValidator'
export { SEEDPHRASE_WORD_COUNTS } from '../../seedphrase/types'

// WalletCore provider access
export { configureWasm, getWalletCore } from '../../context/wasmRuntime'

// MPC engine access (for advanced usage)
export type { MpcEngine, MpcKeyshare, MpcMessage, MpcSession } from '@vultisig/mpc-types'
export { configureMpc, ensureMpcEngine, getMpcEngine } from '@vultisig/mpc-types'

// Vault + fast vault lifecycle classes
export { FastVaultFromSeedphraseService } from '../../services/FastVaultFromSeedphraseService'
export { FastVault } from '../../vault/FastVault'
export { VaultManager } from '../../VaultManager'
export { Vultisig } from '../../Vultisig'

// RN-safe fetch-based RPC helpers (no Node net/tls/http/ws dependency)
export type { JsonRpcCallOptions,JsonRpcParams, JsonRpcResponse } from './rpcFetch'
export { jsonRpcCall, JsonRpcError,queryUrl } from './rpcFetch'
