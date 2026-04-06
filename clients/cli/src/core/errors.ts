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
}

export const EXIT_CODE_DESCRIPTIONS: Record<ExitCode, string> = {
  [ExitCode.SUCCESS]: 'Success',
  [ExitCode.USAGE]: 'Usage error (bad arguments, unknown command)',
  [ExitCode.AUTH_REQUIRED]: 'Authentication required',
  [ExitCode.NETWORK]: 'Network error (retryable)',
  [ExitCode.INVALID_INPUT]: 'Invalid input (bad chain, address, amount)',
  [ExitCode.RESOURCE_NOT_FOUND]: 'Resource not found (token, route)',
  [ExitCode.EXTERNAL_SERVICE]: 'External service error (retryable)',
}

export abstract class VsigError extends Error {
  abstract readonly exitCode: ExitCode
  abstract readonly code: string
  readonly hint?: string
  readonly suggestions?: string[]
  readonly retryable: boolean = false

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message)
    this.name = this.constructor.name
    this.hint = hint
    this.suggestions = suggestions
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

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class InvalidAddressError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INVALID_ADDRESS'

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class InsufficientBalanceError extends VsigError {
  readonly exitCode = ExitCode.INVALID_INPUT
  readonly code = 'INSUFFICIENT_BALANCE'

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class NoRouteError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'NO_ROUTE'

  constructor(message: string, hint?: string, suggestions?: string[]) {
    super(message, hint, suggestions)
  }
}

export class TokenNotFoundError extends VsigError {
  readonly exitCode = ExitCode.RESOURCE_NOT_FOUND
  readonly code = 'TOKEN_NOT_FOUND'

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

export function classifyError(err: Error): VsigError {
  if (err instanceof VsigError) return err
  const msg = err.message.toLowerCase()
  if (msg.includes('unsupported chain') || msg.includes('invalid chain') || msg.includes('unknown chain')) {
    return new InvalidChainError(err.message)
  }
  if (msg.includes('invalid address') || msg.includes('bad address') || msg.includes('malformed address')) {
    return new InvalidAddressError(err.message)
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
  return new UsageError(err.message)
}

export type ErrorJson = {
  ok: false
  v: number
  error: {
    code: string
    message: string
    hint?: string
    suggestions?: string[]
    retryable: boolean
  }
}

export function toErrorJson(err: Error): ErrorJson {
  if (err instanceof VsigError) {
    const json: ErrorJson = {
      ok: false,
      v: 1,
      error: {
        code: err.code,
        message: err.message,
        hint: err.hint,
        retryable: err.retryable,
      },
    }
    if (err.suggestions?.length) json.error.suggestions = err.suggestions
    return json
  }
  return {
    ok: false,
    v: 1,
    error: {
      code: 'UNKNOWN_ERROR',
      message: err.message,
      retryable: false,
    },
  }
}
