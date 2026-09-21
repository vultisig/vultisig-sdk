/**
 * Cap on a single Solana RPC round trip made by a resolver. The shared client
 * sets no request timeout, and a half-open socket can leave `fetch` pending
 * far longer than any broadcast or polling budget; the callers' own deadline
 * checks only run between awaits, so without this one unanswered request
 * could hold them open indefinitely. Matches the repo's default query timeout.
 */
export const solanaRpcTimeoutMs = 20_000

/**
 * Stops waiting on an RPC call after `solanaRpcTimeoutMs`. The underlying
 * request is not aborted (web3.js exposes no signal on these methods); the
 * caller simply treats it as unanswered, which every consumer handles as "no
 * information". A late settlement is swallowed so it cannot surface as an
 * unhandled rejection.
 */
export const withSolanaRpcTimeout = <T>(request: Promise<T>, what: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Solana ${what} timed out after ${solanaRpcTimeoutMs}ms`)),
      solanaRpcTimeoutMs
    )
  })
  request.catch(() => {})

  return Promise.race([request, timeout]).finally(() => clearTimeout(timer))
}
