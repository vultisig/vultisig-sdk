/**
 * When RPCs / indexers cannot build a send tx (UTXO, Subscan, etc.), E2E should skip
 * instead of failing the whole suite.
 */
export function e2ePrepareSendSkipReason(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  if (!msg.includes('Failed to prepare send transaction')) return null
  if (
    msg.includes('insufficient balance or invalid UTXO selection') ||
    msg.includes('insufficient balance') ||
    msg.includes('insufficient funds') ||
    msg.includes('not-enough-funds')
  ) {
    return msg
  }
  if (msg.includes('Subscan') && msg.includes('API key')) {
    return msg
  }
  return null
}
