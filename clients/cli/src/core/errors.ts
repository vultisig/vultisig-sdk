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

export class UnknownError extends VsigError {
  readonly exitCode = ExitCode.UNKNOWN
  readonly code = 'UNKNOWN_ERROR'

  constructor(message: string) {
    super(message)
  }
}

export function classifyError(err: Error): VsigError {
  if (err instanceof VsigError) return err

  if (err instanceof VaultError) {
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
      case VaultErrorCode.InvalidConfig:
        return new UsageError(err.message)
      case VaultErrorCode.UnsupportedToken:
        return new TokenNotFoundError(err.message)
      case VaultErrorCode.BroadcastFailed:
        return new ExternalServiceError(err.message, 'Broadcast failed — the node may be temporarily unavailable', [
          'Retry the transaction',
        ])
      case VaultErrorCode.GasEstimationFailed:
        return new InvalidInputError(err.message, 'Gas estimation failed — check balance and transaction params')
      case VaultErrorCode.SigningFailed:
        return new UnknownError(err.message)
      default:
        return new UnknownError(err.message)
    }
  }

  if (err instanceof VaultImportError) {
    switch (err.code) {
      case VaultImportErrorCode.PASSWORD_REQUIRED:
      case VaultImportErrorCode.INVALID_PASSWORD:
        return new AuthRequiredError(err.message)
      default:
        return new UsageError(err.message)
    }
  }

  // Best-effort heuristic for errors that escape SDK typing — may misclassify
  const msg = err.message.toLowerCase()
  if (msg.includes('unsupported chain') || msg.includes('invalid chain') || msg.includes('unknown chain')) {
    const chainMatch = err.message.match(/chain[:\s]*"([^"]+)"/i) || err.message.match(/chain[:\s]+(\S+)/i)
    return new InvalidChainError(err.message, undefined, undefined, chainMatch ? { chain: chainMatch[1] } : undefined)
  }
  if (msg.includes('invalid address') || msg.includes('bad address') || msg.includes('malformed address')) {
    const addrMatch = err.message.match(/(0x[a-fA-F0-9]+|bc1[a-z0-9]+|[13][a-km-zA-HJ-NP-Z1-9]+)/i)
    return new InvalidAddressError(err.message, undefined, undefined, addrMatch ? { address: addrMatch[1] } : undefined)
  }
  if (msg.includes('insufficient') && msg.includes('balance')) {
    return new InsufficientBalanceError(err.message)
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
