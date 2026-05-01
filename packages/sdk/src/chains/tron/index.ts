// Pure tx builders — no network I/O, no vault.
export type { BuildTrc20TransferOptions, BuildTronSendOptions, TronTxBuilderResult } from './tx'
export { buildTrc20CallData, buildTrc20TransferTx, buildTronSendTx, tronAddressToBytes } from './tx'

// Protobuf primitives — exposed so downstream code can extend this surface
// with `FreezeBalance` etc. without re-implementing varint / tag encoding.
export { encodeInt64Varint, encodeVarint, fieldBytes, fieldInt64, fieldString, fieldVarint } from './proto'

// TronGrid REST helpers — explicit `apiUrl` so consumers keep gateway control.
export type { BroadcastResult, EstimateTrc20EnergyOptions, TronAccountInfo, TronBlockRefs } from './rpc'
export { broadcastTronTx, estimateTrc20Energy, getTronAccount, getTronBlockRefs } from './rpc'
