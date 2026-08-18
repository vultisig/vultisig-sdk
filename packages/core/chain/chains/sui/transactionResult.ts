/**
 * Shared readers for the unified Sui client's transaction result shape.
 *
 * Sui's gRPC / GraphQL clients return a discriminated union rather than the
 * JSON-RPC `{ effects: { status: { status: 'success' | 'failure' } } }` object:
 *
 *   { $kind: 'Transaction',       Transaction:       { status, effects, ... } }
 *   { $kind: 'FailedTransaction', FailedTransaction: { status, effects, ... } }
 *
 * and execution status is `{ success: true, error: null }` /
 * `{ success: false, error: { message, ... } }`.
 *
 * The types below are structural on purpose: `SuiGrpcClient` and
 * `SuiGraphQLClient` produce the same shape but through different generic
 * instantiations, and every resolver here only ever reads status + effects.
 */

export type SuiExecutionStatusLike = {
  success?: boolean
  error?: { message?: string } | null
}

export type SuiGasCostSummaryLike = {
  computationCost?: string
  storageCost?: string
  storageRebate?: string
}

export type SuiTransactionEffectsLike = {
  transactionDigest?: string
  gasUsed?: SuiGasCostSummaryLike
}

export type SuiTransactionLike = {
  digest?: string
  status?: SuiExecutionStatusLike
  effects?: SuiTransactionEffectsLike
}

export type SuiTransactionResultLike = {
  $kind?: 'Transaction' | 'FailedTransaction'
  Transaction?: SuiTransactionLike
  FailedTransaction?: SuiTransactionLike
}

/**
 * The transaction payload of a result, regardless of which arm of the union it
 * arrived on. A failed transaction still carries effects (gas used, digest),
 * which broadcast verification and gas refinement both need.
 */
export const getSuiResultTransaction = (
  result: SuiTransactionResultLike | null | undefined
): SuiTransactionLike | undefined => result?.Transaction ?? result?.FailedTransaction

/**
 * Execution success — NOT transport success.
 *
 * Fails closed: only an explicit `$kind: 'Transaction'` carrying
 * `status.success === true` counts. A `FailedTransaction`, a `success: false`
 * status, or a result with no status at all (malformed / unexpected response)
 * is not proven success and must not be treated as one (sdk#1398).
 */
export const isSuiExecutionSuccess = (result: SuiTransactionResultLike | null | undefined): boolean =>
  result?.$kind === 'Transaction' && getSuiResultTransaction(result)?.status?.success === true

/** Human-readable reason a transaction did not execute successfully. */
export const describeSuiExecutionFailure = (result: SuiTransactionResultLike | null | undefined): string => {
  const status = getSuiResultTransaction(result)?.status

  if (status?.error?.message) return status.error.message
  if (status?.success === false) return 'execution failed'
  if (result?.$kind === 'FailedTransaction') return 'transaction did not execute'

  return 'no execution status returned'
}
