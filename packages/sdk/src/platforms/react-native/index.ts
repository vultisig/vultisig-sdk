/**
 * React Native platform entry point
 *
 * Registers the native MPC engine and native WalletCore.
 * Exports RN-compatible SDK APIs.
 */
import { NativeMpcEngine } from '@vultisig/mpc-native'
import { configureMpc } from '@vultisig/mpc-types'
import { NativeWalletCore } from '@vultisig/walletcore-native'

import { configureWasm } from '../../context/wasmRuntime'

// Register native MPC engine
configureMpc(new NativeMpcEngine())

// Register native WalletCore as the WalletCore provider
configureWasm(async () => NativeWalletCore.getInstance())

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
export { configureMpc, getMpcEngine } from '@vultisig/mpc-types'
