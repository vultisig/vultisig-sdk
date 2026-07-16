import { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from '@vultisig/sdk'

// Typed exit codes for machine-readable error handling
// Enables agents to distinguish error types programmatically

export enum ExitCode {
  SUCCESS = 0,
  USAGE = 1,
  AUTH_REQUIRED = 2,
  NETWORK = 3,
  INVALID_INPUT = 4,
  RESOURCE_NOT_FOUND = 5,
  EXTERNAL_SERVICE = 6,
  UNKNOWN = 7,
  // Broadcast succeeded on-chain but the post-broadcast acknowledgement/report
  // back to the backend failed. The emitted tx hash IS VALID — do NOT blindly
  // retry (that risks a double-spend); track/confirm the hash instead.
  ACK_FAILED = 8,
  // A signing attempt was refused by the local broadcast-journal duplicate guard
  // (an identical intent was broadcast recently and hasn't definitively failed,
  // or a sibling process holds the reservation). NOTHING was broadcast. Distinct
  // from generic invalid input (4) so `$?` alone can branch the fund-safety
  // refusal. Retry with --force to override. See broadcastJournal.ts.
  DUPLICATE_BROADCAST = 9,
  // `agent ask` only: the backend deliberately BLOCKED the requested action via a
  // fund-safety guardrail (turn_outcome kind='blocked'). The turn completed but the
  // action did not happen and won't on retry without changing the request. Distinct
  // from a generic error (1) so a headless caller can branch a safety block from a
  // transient failure. Requires a backend that emits data-turn_outcome (a2a-02).
  AGENT_TURN_BLOCKED = 10,
  // `agent ask` only: the model REFUSED or asked a clarifying question with no
  // actionable result (turn_outcome kind='refusal'). Not an error and not a safety
  // block — the caller likely needs to refine the prompt. Requires a backend that
  // emits data-turn_outcome (a2a-02).
  AGENT_TURN_REFUSAL = 11,
  // An interactive confirmation/input was required but the session is
  // non-interactive (a piped/redirected stdout, or --non-interactive/--ci). NOTHING
  // was signed or broadcast. Distinct from generic UNKNOWN (7) so a headless caller
  // can branch "needs --yes/--confirm or a required flag" from an unexpected crash.
  CONFIRMATION_REQUIRED = 12,
  // `agent ask` only: at least one transaction was submitted on-chain, but a
  // later backend/stream outcome means the overall request may be incomplete.
  // This is a non-retryable partial success: inspect the emitted hashes before
  // deciding how to continue, and never blindly replay the original request.
  BROADCAST_COMMITTED = 13,
  // The backend already accepted this exact keyed agent turn. The duplicate
  // request did not execute or consume credits; inspect the conversation for
  // the first attempt's persisted result before starting a fresh attempt.
  IDEMPOTENT_TURN_DUPLICATE = 14,
}

export const EXIT_CODE_DESCRIPTIONS: Record<ExitCode, string> = {
  [ExitCode.SUCCESS]: 'Success',
  [ExitCode.USAGE]: 'Usage error (bad arguments, unknown command)',
  [ExitCode.AUTH_REQUIRED]: 'Authentication required',
  [ExitCode.NETWORK]: 'Network error (retryable)',
  [ExitCode.INVALID_INPUT]: 'Invalid input (bad chain, address, amount)',
  [ExitCode.RESOURCE_NOT_FOUND]: 'Resource not found (token, route)',
  [ExitCode.EXTERNAL_SERVICE]: 'External service error (retryable)',
  [ExitCode.UNKNOWN]: 'Unknown/unexpected error',
  [ExitCode.ACK_FAILED]: 'Broadcast succeeded but post-broadcast report failed — hash is valid, do NOT retry',
  [ExitCode.DUPLICATE_BROADCAST]: 'Duplicate broadcast refused (nothing sent) — retry with --force to override',
  [ExitCode.AGENT_TURN_BLOCKED]: 'agent ask: a fund-safety guardrail blocked the requested action',
  [ExitCode.AGENT_TURN_REFUSAL]: 'agent ask: the model refused or asked a clarifying question (no action taken)',
  [ExitCode.CONFIRMATION_REQUIRED]:
    'Interactive confirmation/input required but the session is non-interactive — pass --yes/--confirm or the required flag',
  [ExitCode.BROADCAST_COMMITTED]:
    'agent ask: transaction broadcast but the overall request may be incomplete — inspect the hash, do NOT blindly retry',
  [ExitCode.IDEMPOTENT_TURN_DUPLICATE]:
    'agent ask: duplicate keyed turn rejected — inspect the conversation for the original result',
}

export abstract class VsigError extends Error {
  abstract readonly exitCode: ExitCode
  abstract readonly code: string
  readonly hint?: string
  readonly suggestions?: string[]
  readonly context?: Record<string, string>
  readonly retryable: boolean = false

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message)
    this.name = this.constructor.name
    this.hint = hint
    this.suggestions = suggestions
    this.context = context
  }
}

export class UsageError extends VsigError {
  readonly exitCode = ExitCode.USAGE
  readonly code = 'USAGE_ERROR'

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class AuthRequiredError extends VsigError {
  readonly exitCode = ExitCode.AUTH_REQUIRED
  readonly code = 'AUTH_REQUIRED'

  constructor(message?: string) {
    super(message ?? 'Authentication required. Set up vault credentials.', 'Ensure your vault is unlocked', [
      'vsig vaults',
      'vsig create',
    ])
  }
}

export class NetworkError extends VsigError {
  readonly exitCode = ExitCode.NETWORK
  readonly code = 'NETWORK_ERROR'
  override readonly retryable = true

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class InvalidChainError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INVALID_CHAIN'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class InvalidAddressError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INVALID_ADDRESS'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class InvalidInputError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INVALID_INPUT'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

/** A transaction hash whose shape is invalid for the selected chain. */
export class InvalidTxHashError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INVALID_HASH'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class InsufficientBalanceError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INSUFFICIENT_BALANCE'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class NoRouteError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'NO_ROUTE'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class TokenNotFoundError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'TOKEN_NOT_FOUND'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class TxNotFoundError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'TX_NOT_FOUND'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class VaultNotFoundError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'VAULT_NOT_FOUND'

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

// A bounded status poll gave up while the tx was still (plausibly) in-flight.
// Retryable: the tx may confirm later, so re-checking / waiting longer is valid —
// distinct from TxNotFoundError, where the node affirmatively has no record.
export class TxStatusTimeoutError extends VsigError {
  readonly exitCode = ExitCode.NETWORK
  readonly code = 'TX_STATUS_TIMEOUT'
  override readonly retryable = true

  constructor(message: string, hint?: string, suggestions?: string[], context?: Record<string, string>) {
    super(message, hint, suggestions, context)
  }
}

export class ExternalServiceError extends VsigError {
  readonly exitCode = ExitCode.EXTERNAL_SERVICE
  readonly code = 'EXTERNAL_SERVICE'
  override readonly retryable = true

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class PricingUnavailableError extends VsigError {
  readonly exitCode = ExitCode.EXTERNAL_SERVICE
  readonly code = 'PRICING_UNAVAILABLE'
  override readonly retryable = true

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class ConfirmationRequiredError extends VsigError {
  readonly exitCode = ExitCode.CONFIRMATION_REQUIRED
  readonly code = 'CONFIRMATION_REQUIRED'

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

/** The backend already accepted the same idempotency-keyed agent turn (same key,
 *  same body). The first attempt's result IS persisted — the caller should read
 *  it, not replay the request. */
export class IdempotentTurnDuplicateError extends VsigError {
  readonly exitCode = ExitCode.IDEMPOTENT_TURN_DUPLICATE
  readonly code = 'IDEMPOTENT_TURN_DUPLICATE'

  constructor(message: string, conversationId?: string, firstRequestAt?: string) {
    super(
      message,
      'The duplicate did not execute; inspect the conversation for the first attempt result',
      ['Retry only as a new user-initiated attempt'],
      keyedTurnContext(conversationId, firstRequestAt)
    )
  }
}

/** The idempotency key was already used for a DIFFERENT request body. Unlike a
 *  duplicate, THIS operation never ran and nothing was persisted for it — the
 *  claim belongs to another request, so there is no "original result" to inspect.
 *  A caller protocol bug (the CLI mints a fresh key per attempt), hence
 *  INVALID_INPUT: the request was malformed and nothing happened. */
export class IdempotencyKeyReusedError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'IDEMPOTENCY_KEY_REUSED'

  constructor(message: string, conversationId?: string, firstRequestAt?: string) {
    super(
      message,
      'This request did NOT execute; the key is bound to a different request body, so no result was persisted for it',
      ['Retry this operation with a fresh idempotency key'],
      keyedTurnContext(conversationId, firstRequestAt)
    )
  }
}

/** Shared context for the keyed-turn 409s. `first_request_at` locates the claim
 *  that won the key — without it, "inspect the conversation" has no anchor. */
function keyedTurnContext(conversationId?: string, firstRequestAt?: string): Record<string, string> | undefined {
  const context: Record<string, string> = {}
  if (conversationId) context.conversationId = conversationId
  if (firstRequestAt) context.firstRequestAt = firstRequestAt
  return Object.keys(context).length > 0 ? context : undefined
}

export class UnknownError extends VsigError {
  readonly exitCode = ExitCode.UNKNOWN
  readonly code = 'UNKNOWN_ERROR'

  constructor(message: string) {
    super(message)
  }
}

/**
 * The local broadcast-journal refused to sign because an identical intent was
 * broadcast recently (and hasn't definitively failed) or a sibling process holds
 * the reservation. NOTHING was broadcast. Maps the journal's
 * `DuplicateBroadcastError` / `ConcurrentBroadcastError` (both carry
 * `code === 'DUPLICATE_BROADCAST'`) onto the dedicated exit code 9 so a headless
 * caller can branch the fund-safety refusal on `$?` alone. Retry with `--force`.
 */
export class DuplicateBroadcastRefusedError extends VsigError {
  readonly exitCode = ExitCode.DUPLICATE_BROADCAST
  readonly code = 'DUPLICATE_BROADCAST'

  constructor(message: string) {
    super(message, 'An identical transaction was broadcast recently and has not definitively failed', [
      'Check its status with: vsig tx-status',
      'Re-broadcast anyway with: --force',
    ])
  }
}

function isPermanentBroadcastInputError(err: VaultError): boolean {
  const details = `${err.message}\n${err.originalError?.message ?? ''}`
  return /failed to decode signed transaction|could not decode (?:signed )?transaction|invalid raw transaction|invalid transaction encoding|invalid (?:transaction )?signature|invalid sender|invalid rlp|rlp:|unsupported transaction type/i.test(
    details
  )
}

// The SDK words a bad receiver differently depending on which layer rejects it:
// VaultBase throws VaultError(InvalidConfig, "Invalid receiver address for chain
// X: …") while the vault-free prep helpers throw a plain Error carrying the same
// text. Both must land on INVALID_ADDRESS/4, so both classifier paths share this.
const INVALID_ADDRESS_RE = /invalid (?:receiver |recipient |destination )?address|bad address|malformed address/i

function invalidAddressError(message: string): InvalidAddressError {
  const addrMatch = message.match(/(0x[a-fA-F0-9]+|bc1[a-z0-9]+|[13][a-km-zA-HJ-NP-Z1-9]+)/i)
  return new InvalidAddressError(message, undefined, undefined, addrMatch ? { address: addrMatch[1] } : undefined)
}

function classifyVaultError(err: VaultError): VsigError {
  // BalanceFetchFailed is a wrapper code — the real cause may be invalid input
  // (e.g. unknown chain). Unwrap originalError so we don't mis-tag validation
  // errors as retryable network errors.
  if (err.code === VaultErrorCode.BalanceFetchFailed && err.originalError) {
    const inner = classifyError(err.originalError)
    if (!(inner instanceof UnknownError)) return inner
  }

  switch (err.code) {
    case VaultErrorCode.UnsupportedChain:
    case VaultErrorCode.ChainNotSupported:
      return new InvalidChainError(err.message)
    case VaultErrorCode.NetworkError:
    case VaultErrorCode.BalanceFetchFailed:
    case VaultErrorCode.Timeout:
      return new NetworkError(err.message)
    case VaultErrorCode.InvalidAmount:
      return new InvalidInputError(err.message)
    case VaultErrorCode.InvalidConfig: {
      // SDK overloads InvalidConfig for "Unknown chain" — detect and reclassify
      // so agents get INVALID_INPUT / non-retryable instead of generic USAGE.
      const lowerMsg = err.message.toLowerCase()
      if (
        lowerMsg.includes('unknown chain') ||
        lowerMsg.includes('unsupported chain') ||
        lowerMsg.includes('chain not supported')
      ) {
        const chainMatch = err.message.match(/chain[:\s]*"([^"]+)"/i)
        return new InvalidChainError(
          err.message,
          undefined,
          undefined,
          chainMatch ? { chain: chainMatch[1] } : undefined
        )
      }
      // InvalidConfig is also the SDK's slot for a bad receiver (VaultBase.ts:1051).
      // Without this, `send` fell to the UsageError default (exit 1) while
      // `address-book` reported the same class as INVALID_ADDRESS (4) — the
      // documented code. Unify on 4.
      if (INVALID_ADDRESS_RE.test(lowerMsg)) return invalidAddressError(err.message)
      if (lowerMsg.includes('failed to unlock vault') || lowerMsg.includes('invalid password')) {
        return new AuthRequiredError(err.message)
      }
      return new UsageError(err.message)
    }
    case VaultErrorCode.VaultNotFound:
      return new VaultNotFoundError(err.message)
    case VaultErrorCode.UnsupportedToken:
      return new TokenNotFoundError(err.message)
    case VaultErrorCode.BroadcastFailed:
      if (isPermanentBroadcastInputError(err)) {
        return new InvalidInputError(err.message, 'Check the signed transaction encoding and signature')
      }
      return new ExternalServiceError(err.message, 'Broadcast failed — the node may be temporarily unavailable', [
        'Retry the transaction',
      ])
    case VaultErrorCode.GasEstimationFailed:
      return new InvalidInputError(err.message, 'Gas estimation failed — check balance and transaction params')
    case VaultErrorCode.SigningFailed:
      if (/must be 32 bytes|expected 32 bytes|non-32-byte/i.test(err.message)) {
        return new InvalidInputError(err.message)
      }
      return new UnknownError(err.message)
    default:
      return new UnknownError(err.message)
  }
}

export function classifyError(err: Error): VsigError {
  if (err instanceof VsigError) return err

  // The journal's duplicate/concurrent refusals aren't VaultErrors — they carry
  // a stable `code === 'DUPLICATE_BROADCAST'`. Map them to exit 9 before the
  // generic classification below (which would otherwise fall through to
  // UNKNOWN/7 and lose the fund-safety signal).
  if ((err as { code?: unknown }).code === 'DUPLICATE_BROADCAST') {
    return new DuplicateBroadcastRefusedError(err.message)
  }

  if (err instanceof VaultError) return classifyVaultError(err)

  if (err instanceof VaultImportError) {
    switch (err.code) {
      case VaultImportErrorCode.PASSWORD_REQUIRED:
      case VaultImportErrorCode.INVALID_PASSWORD:
        return new AuthRequiredError(err.message)
      default:
        return new UsageError(err.message)
    }
  }

  if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    return new InvalidInputError(err.message, 'Check that the file or directory exists')
  }

  // Best-effort heuristic for errors that escape SDK typing — may misclassify
  const msg = err.message.toLowerCase()
  if (msg.includes('no vault found matching') || msg.includes('vault not found')) {
    return new VaultNotFoundError(err.message)
  }
  if (msg.includes('unsupported chain') || msg.includes('invalid chain') || msg.includes('unknown chain')) {
    const chainMatch = err.message.match(/chain[:\s]*"([^"]+)"/i) || err.message.match(/chain[:\s]+(\S+)/i)
    return new InvalidChainError(err.message, undefined, undefined, chainMatch ? { chain: chainMatch[1] } : undefined)
  }
  // Same wording, thrown as a plain Error by the vault-free prep helpers
  // (tools/prep/send.ts:60) rather than wrapped in a VaultError.
  if (INVALID_ADDRESS_RE.test(msg)) return invalidAddressError(err.message)
  if (msg.includes('insufficient') && msg.includes('balance')) {
    return new InsufficientBalanceError(err.message)
  }
  if (
    msg.includes('invalid currency') ||
    msg.includes('invalid amount') ||
    msg.includes('invalid mnemonic') ||
    msg.includes('invalid seedphrase') ||
    msg.includes('must be 32 bytes') ||
    msg.includes('expected 32 bytes') ||
    msg.includes('non-32-byte')
  ) {
    return new InvalidInputError(err.message)
  }
  if (msg.includes('no route') || msg.includes('no swap') || msg.includes('no provider')) {
    return new NoRouteError(err.message)
  }
  if (msg.includes('token not found') || msg.includes('unknown token')) {
    return new TokenNotFoundError(err.message)
  }
  if (msg.includes('pricing') || msg.includes('price unavailable') || msg.includes('price service')) {
    return new PricingUnavailableError(err.message)
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('dns')
  ) {
    return new NetworkError(err.message)
  }
  return new UnknownError(err.message)
}

export type ErrorJson = {
  success: false
  v: number
  error: {
    code: string
    exitCode: number
    message: string
    hint?: string
    suggestions?: string[]
    context?: Record<string, string>
    retryable: boolean
  }
}

export function toErrorJson(err: Error): ErrorJson {
  if (err instanceof VsigError) {
    const json: ErrorJson = {
      success: false,
      v: 1,
      error: {
        code: err.code,
        exitCode: err.exitCode,
        message: err.message,
        hint: err.hint,
        retryable: err.retryable,
      },
    }
    if (err.suggestions?.length) json.error.suggestions = err.suggestions
    if (err.context) json.error.context = err.context
    return json
  }
  return {
    success: false,
    v: 1,
    error: {
      code: 'UNKNOWN_ERROR',
      exitCode: ExitCode.UNKNOWN,
      message: err.message,
      retryable: false,
    },
  }
}
