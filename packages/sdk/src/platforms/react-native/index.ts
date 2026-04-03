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

// Address derivation and chain utilities
export { getCoinType } from '@vultisig/core-chain/coin/coinType'
export { deriveAddress } from '@vultisig/core-chain/publicKey/address/deriveAddress'
export { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
export { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'

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
