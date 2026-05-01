/**
 * THORChain swap memos append `:<liquidity_tolerance>/<streaming_interval>/<streaming_quantity>`
 * for streaming swaps. Rapid swaps omit this suffix.
 */
export const parseThorchainSwapMemoStreaming = (
  memo: string
): { streamingInterval: string; streamingQuantity: string } => {
  const segments = memo.split(':')
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const triple = /^(\d+)\/(\d+)\/(\d+)$/.exec(segments[i])
    if (triple) {
      return {
        streamingInterval: triple[2],
        streamingQuantity: triple[3],
      }
    }
  }
  return { streamingInterval: '0', streamingQuantity: '0' }
}
