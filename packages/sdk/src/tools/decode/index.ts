import { decodeCosmosTx } from './cosmos'
import { decodeEvmTx } from './evm'
import { decodeFromToolResult } from './fromToolResult'

export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult }
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './types'

// Public namespace handle matching the documented `sdk.decode.fromToolResult`
// surface while keeping the existing flat named exports intact.
export const decode = {
  cosmosTx: decodeCosmosTx,
  evmTx: decodeEvmTx,
  fromToolResult: decodeFromToolResult,
} as const
