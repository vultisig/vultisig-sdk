/**
 * React Native platform entry point
 *
 * Registers the native MPC engine.
 * Exports only RN-compatible SDK APIs (no Node.js deps).
 */
import { NativeMpcEngine } from '@vultisig/mpc-native'
import { configureMpc } from '@vultisig/mpc-types'

// Register native MPC engine
configureMpc(new NativeMpcEngine())

// Chain enum and types (pure constants, no Node.js deps)
export { Chain } from '@vultisig/core-chain/Chain'

// MPC keysign (uses MpcEngine — no direct WASM imports)
export { keysign } from '@vultisig/core-mpc/keysign'

// Seedphrase validation (uses @scure/bip39, RN-compatible)
export { validateSeedphrase } from '../../seedphrase/SeedphraseValidator'
export { SEEDPHRASE_WORD_COUNTS } from '../../seedphrase/types'

// MPC engine access (for advanced usage)
export type { MpcEngine, MpcKeyshare, MpcMessage,MpcSession } from '@vultisig/mpc-types'
export { configureMpc, getMpcEngine } from '@vultisig/mpc-types'
