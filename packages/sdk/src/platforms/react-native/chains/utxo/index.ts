/**
 * RN bridge for UTXO chains.
 *
 * Thin re-export of the core UTXO module at `src/chains/utxo/**` — the logic
 * is platform-agnostic (uses @noble/hashes + @scure/base + bs58check only, no
 * bitcoinjs-lib at runtime) so RN, Node, Browser, and Electron all share the
 * same implementation with zero bundler-specific code paths.
 *
 * Coverage: Bitcoin, Litecoin, Dogecoin, Dash, Bitcoin-Cash, Zcash.
 */
export type {
  BroadcastUtxoTxOptions,
  BuildUtxoSendOptions,
  DecodedAddress,
  EstimateUtxoFeeOptions,
  GetUtxoBalanceOptions,
  GetUtxosOptions,
  PlainUtxo,
  SighashBIP143Options,
  SighashLegacyOptions,
  UtxoApiKind,
  UtxoApiOptions,
  UtxoChainName,
  UtxoInput,
  UtxoTxBuilderResult,
} from '../../../../chains/utxo'
export {
  broadcastUtxoTx,
  buildUtxoSendTx,
  decodeAddressToPubKeyHash,
  deriveUtxoPubkey,
  estimateUtxoFee,
  getSighashBIP143,
  getSighashLegacy,
  getUtxoBalance,
  getUtxoChainSpec,
  getUtxos,
} from '../../../../chains/utxo'
