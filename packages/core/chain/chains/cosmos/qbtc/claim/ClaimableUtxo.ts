/** A Bitcoin UTXO that can potentially be claimed on the QBTC chain. */
export type ClaimableUtxo = {
  txid: string
  vout: number
  /** BTC amount in satoshis. */
  amount: number
}
