export type CosmosSequenceMismatchRecovery = 'resign' | 'wait'

export type CosmosSequenceMismatch = {
  expectedSequence: bigint
  signedSequence: bigint
  recovery: CosmosSequenceMismatchRecovery
}

const COSMOS_SEQUENCE_MISMATCH_RE =
  /broadcasting transaction failed with code 32 \(codespace: sdk\)\. log: account sequence mismatch, expected (\d{1,20}), got (\d{1,20}): incorrect account sequence/i
const UINT64_MAX = (1n << 64n) - 1n

const parseCosmosSequenceMismatchMessage = (message: string): CosmosSequenceMismatch | undefined => {
  const match = message.match(COSMOS_SEQUENCE_MISMATCH_RE)
  if (!match) return undefined

  const expectedSequence = BigInt(match[1])
  const signedSequence = BigInt(match[2])
  if (expectedSequence > UINT64_MAX || signedSequence > UINT64_MAX || expectedSequence === signedSequence) {
    return undefined
  }

  return {
    expectedSequence,
    signedSequence,
    recovery: signedSequence < expectedSequence ? 'resign' : 'wait',
  }
}

const getNestedErrors = (error: object): unknown[] => {
  const nested: unknown[] = []
  if ('cause' in error && error.cause !== undefined) nested.push(error.cause)
  if ('originalError' in error && (error as { originalError?: unknown }).originalError !== undefined) {
    nested.push((error as { originalError: unknown }).originalError)
  }
  return nested
}

/**
 * A Cosmos CheckTx code-32 rejection with the sequence direction preserved.
 *
 * `resign` means the signed sequence is already behind chain state, so these
 * exact bytes can never become valid. `wait` means the signed sequence is
 * ahead of chain state and may become valid after the preceding transaction
 * is accepted.
 */
export class CosmosSequenceMismatchError extends Error {
  readonly expectedSequence: bigint
  readonly signedSequence: bigint
  readonly recovery: CosmosSequenceMismatchRecovery

  constructor(
    { expectedSequence, signedSequence }: Pick<CosmosSequenceMismatch, 'expectedSequence' | 'signedSequence'>,
    options?: ErrorOptions
  ) {
    const recovery = signedSequence < expectedSequence ? 'resign' : 'wait'
    const message =
      recovery === 'resign'
        ? `Cosmos account sequence changed before broadcast: this transaction was signed with sequence ${signedSequence}, but the chain expects ${expectedSequence}. Rebuild the transaction with the latest account sequence and start a new signing ceremony; retrying these signed bytes cannot succeed.`
        : `Cosmos account sequence is not ready: this transaction was signed with sequence ${signedSequence}, but the chain expects ${expectedSequence}. Wait for the preceding transaction to be accepted, then retry these signed bytes. If the chain advances past sequence ${signedSequence}, rebuild the transaction and start a new signing ceremony.`

    super(message, options)
    this.name = 'CosmosSequenceMismatchError'
    this.expectedSequence = expectedSequence
    this.signedSequence = signedSequence
    this.recovery = recovery
  }
}

/**
 * Finds a Cosmos code-32 account-sequence rejection through ordinary Error
 * causes and the SDK's `VaultError.originalError` wrapper.
 */
export const toCosmosSequenceMismatchError = (error: unknown): CosmosSequenceMismatchError | undefined => {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()

  while (pending.length > 0) {
    const current = pending.shift()
    if (current == null || seen.has(current)) continue
    seen.add(current)

    if (current instanceof CosmosSequenceMismatchError) return current

    const message = current instanceof Error ? current.message : typeof current === 'string' ? current : undefined
    if (message) {
      const mismatch = parseCosmosSequenceMismatchMessage(message)
      if (mismatch) {
        return new CosmosSequenceMismatchError(mismatch, {
          cause: current instanceof Error ? current : new Error(String(current)),
        })
      }
    }

    if (typeof current === 'object') pending.push(...getNestedErrors(current))
  }

  return undefined
}
