/**
 * RN bridge for Tron.
 *
 * Thin re-export of the core Tron module at `src/chains/tron/**` — the
 * implementation is a hand-rolled protobuf encoder + TronGrid REST helpers,
 * so it has no native or Hermes-hostile dependencies (`tronweb` ships with
 * a transitive `ws` + `node-fetch` cascade we never want to eval at module
 * init).
 *
 * Covered surface:
 *   - `buildTronSendTx`        — native TRX transfer
 *   - `buildTrc20TransferTx`   — TRC-20 token transfer (USDT etc.)
 *   - `getTronBlockRefs`       — latest block hash + ref_block_* for building tx
 *   - `getTronAccount`         — balance + bandwidth/energy
 *   - `estimateTrc20Energy`    — contract-call energy prediction
 *   - `broadcastTronTx`        — `/wallet/broadcasthex`
 */
export type {
  BroadcastResult,
  BuildTrc20TransferOptions,
  BuildTronSendOptions,
  EstimateTrc20EnergyOptions,
  TronAccountInfo,
  TronBlockRefs,
  TronTxBuilderResult,
} from '../../../../chains/tron'
export {
  broadcastTronTx,
  buildTrc20CallData,
  buildTrc20TransferTx,
  buildTronSendTx,
  encodeInt64Varint,
  encodeVarint,
  estimateTrc20Energy,
  fieldBytes,
  fieldInt64,
  fieldString,
  fieldVarint,
  getTronAccount,
  getTronBlockRefs,
  tronAddressToBytes,
} from '../../../../chains/tron'
