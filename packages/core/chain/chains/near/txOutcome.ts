/** The part of a NEAR `send_tx` / `tx` answer that names the transaction it reports. */
export type NearTxOutcome = {
  final_execution_status?: unknown
  transaction?: { hash?: unknown }
  transaction_outcome?: { id?: unknown }
}

export const readNearOutcomeHash = (outcome: NearTxOutcome | undefined): string | undefined => {
  const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id

  return typeof hash === 'string' && hash.length > 0 ? hash : undefined
}
