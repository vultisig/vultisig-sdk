import { decodeCosmosTx } from './cosmos'
import { decodeEvmTx } from './evm'
import { decodeFromToolResult } from './fromToolResult'

export { decodeCosmosTx } from './cosmos'
export { decodeEvmTx } from './evm'
export { decodeFromToolResult } from './fromToolResult'
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './types'

/**
 * Canonical `sdk.decode` namespace — the shape documented as the "bytes
 * oracle" keystone (see `tools/policy/types.ts`'s `Envelope` doc comment).
 * `fromToolResult` is aliased (not `decodeFromToolResult`) to match that
 * documented `sdk.decode.fromToolResult` surface exactly.
 */
export const decode = {
  fromToolResult: decodeFromToolResult,
  decodeCosmosTx,
  decodeEvmTx,
}
