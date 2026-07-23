import { decodeCosmosTx } from './cosmos'
import { decodeEvmTx } from './evm'
import { decodeFromToolResult } from './fromToolResult'

export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult }
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './types'

/**
 * Documented decode namespace — callers can use `sdk.decode.fromToolResult(...)`
 * without hand-rolling their own wrapper object around the flat helpers.
 */
export const decode = {
  fromToolResult: decodeFromToolResult,
  decodeCosmosTx,
  decodeEvmTx,
} as const
