export type SolanaBlockhashExpiredDetails = {
  signature?: string
  lastValidBlockHeight?: number
}

const SOLANA_BLOCKHASH_EXPIRED_RE = /^Solana blockhash expired before the transaction was confirmed\./
const SIGNATURE_RE = /Signature ([1-9A-HJ-NP-Za-km-z]{32,128}) was never seen/
const BLOCK_HEIGHT_RE = /by block height (\d{1,16})\./

const describeExpiry = ({ signature, lastValidBlockHeight }: SolanaBlockhashExpiredDetails): string => {
  const subject = signature
    ? `Signature ${signature} was never seen on-chain`
    : 'The transaction was never seen on-chain'
  const bound = lastValidBlockHeight === undefined ? '' : ` by block height ${lastValidBlockHeight}`

  return `Solana blockhash expired before the transaction was confirmed. ${subject}${bound}. Rebuild the transaction with a fresh blockhash and start a new signing ceremony; retrying these signed bytes cannot succeed.`
}

/**
 * A signed Solana transaction whose blockhash aged out before any node
 * confirmed it. The bytes are dead: only a rebuild with a fresh blockhash and a
 * new signing ceremony can succeed, which `recovery` states for callers that
 * branch on it the way they do for a stale Cosmos sequence.
 *
 * Deliberately carries no `cause`: the SDK's broadcast wrapper replaces any
 * error that has one with a plain copy, and the instance is what consumers
 * match on.
 */
export class SolanaBlockhashExpiredError extends Error {
  readonly signature?: string
  readonly lastValidBlockHeight?: number
  readonly recovery = 'resign' as const

  constructor(details: SolanaBlockhashExpiredDetails = {}) {
    super(describeExpiry(details))
    this.name = 'SolanaBlockhashExpiredError'
    this.signature = details.signature
    this.lastValidBlockHeight = details.lastValidBlockHeight
  }
}

const parseSolanaBlockhashExpiredMessage = (message: string): SolanaBlockhashExpiredDetails | undefined => {
  if (!SOLANA_BLOCKHASH_EXPIRED_RE.test(message)) return undefined

  const height = message.match(BLOCK_HEIGHT_RE)?.[1]

  return {
    signature: message.match(SIGNATURE_RE)?.[1],
    lastValidBlockHeight: height === undefined ? undefined : Number(height),
  }
}

const getNestedErrors = (error: object): unknown[] => {
  const nested: unknown[] = []
  if ('cause' in error && error.cause !== undefined) nested.push(error.cause)
  if ('originalError' in error && error.originalError !== undefined) nested.push(error.originalError)
  return nested
}

/**
 * Finds a Solana blockhash expiry through ordinary Error causes and the SDK's
 * `VaultError.originalError` wrapper, rebuilding it from the message when a
 * wrapper kept only the text.
 */
export const toSolanaBlockhashExpiredError = (error: unknown): SolanaBlockhashExpiredError | undefined => {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()

  while (pending.length > 0) {
    const current = pending.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)

    if (current instanceof SolanaBlockhashExpiredError) return current

    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : undefined
    if (message) {
      const details = parseSolanaBlockhashExpiredMessage(message)
      if (details) return new SolanaBlockhashExpiredError(details)
    }

    if (typeof current === 'object') pending.push(...getNestedErrors(current))
  }

  return undefined
}
