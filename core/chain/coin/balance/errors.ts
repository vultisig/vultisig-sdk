/**
 * Balance lookup error types and handling
 */

export enum BalanceErrorType {
  TIMEOUT = 'TIMEOUT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  API_ERROR = 'API_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  UNSUPPORTED_CHAIN = 'UNSUPPORTED_CHAIN',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
}

export class BalanceLookupError extends Error {
  public readonly type: BalanceErrorType
  public readonly chain: string
  public readonly address: string
  public readonly attempts: number
  public readonly duration: number
  public readonly originalError?: Error

  constructor(
    type: BalanceErrorType,
    chain: string,
    address: string,
    message: string,
    attempts: number = 1,
    duration: number = 0,
    originalError?: Error
  ) {
    super(message)
    this.name = 'BalanceLookupError'
    this.type = type
    this.chain = chain
    this.address = address
    this.attempts = attempts
    this.duration = duration
    this.originalError = originalError
  }

  static fromTimeout(
    chain: string,
    address: string,
    timeoutMs: number,
    attempt: number
  ): BalanceLookupError {
    return new BalanceLookupError(
      BalanceErrorType.TIMEOUT,
      chain,
      address,
      `Balance lookup timed out after ${timeoutMs}ms`,
      attempt,
      timeoutMs
    )
  }

  static fromNetworkError(
    chain: string,
    address: string,
    originalError: Error,
    attempt: number
  ): BalanceLookupError {
    return new BalanceLookupError(
      BalanceErrorType.NETWORK_ERROR,
      chain,
      address,
      `Network error during balance lookup: ${originalError.message}`,
      attempt,
      0,
      originalError
    )
  }

  static fromApiError(
    chain: string,
    address: string,
    statusCode: number,
    response: string,
    attempt: number
  ): BalanceLookupError {
    return new BalanceLookupError(
      BalanceErrorType.API_ERROR,
      chain,
      address,
      `API error (${statusCode}): ${response}`,
      attempt
    )
  }

  static fromRateLimit(
    chain: string,
    address: string,
    retryAfter?: number
  ): BalanceLookupError {
    const message = retryAfter
      ? `Rate limited, retry after ${retryAfter}s`
      : 'Rate limited by API'

    return new BalanceLookupError(
      BalanceErrorType.API_RATE_LIMIT,
      chain,
      address,
      message
    )
  }

  static fromInvalidResponse(
    chain: string,
    address: string,
    response: any,
    attempt: number
  ): BalanceLookupError {
    return new BalanceLookupError(
      BalanceErrorType.INVALID_RESPONSE,
      chain,
      address,
      `Invalid API response format: ${JSON.stringify(response)}`,
      attempt
    )
  }

  static fromUnsupportedChain(
    chain: string,
    address: string
  ): BalanceLookupError {
    return new BalanceLookupError(
      BalanceErrorType.UNSUPPORTED_CHAIN,
      chain,
      address,
      `Chain '${chain}' is not supported for balance lookups`
    )
  }
}

/**
 * Classifies common error patterns and returns appropriate BalanceLookupError
 */
export function classifyBalanceError(
  chain: string,
  address: string,
  error: any,
  attempt: number
): BalanceLookupError {
  const errorMessage = error?.message || String(error)

  // Timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
    return BalanceLookupError.fromTimeout(chain, address, 8000, attempt)
  }

  // Network errors
  if (
    errorMessage.includes('fetch') ||
    errorMessage.includes('network') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('ECONNREFUSED') ||
    errorMessage.includes('ENOTFOUND')
  ) {
    return BalanceLookupError.fromNetworkError(chain, address, error, attempt)
  }

  // Rate limiting
  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    error?.status === 429
  ) {
    return BalanceLookupError.fromRateLimit(chain, address)
  }

  // API errors (4xx, 5xx status codes)
  if (error?.status && error.status >= 400) {
    return BalanceLookupError.fromApiError(
      chain,
      address,
      error.status,
      error.response || errorMessage,
      attempt
    )
  }

  // Invalid response format
  if (errorMessage.includes('invalid') || errorMessage.includes('unexpected')) {
    return BalanceLookupError.fromInvalidResponse(
      chain,
      address,
      error.response || error,
      attempt
    )
  }

  // Unsupported chain
  if (
    errorMessage.includes('unsupported') ||
    errorMessage.includes('not supported')
  ) {
    return BalanceLookupError.fromUnsupportedChain(chain, address)
  }

  // Default to network error for unknown issues
  return BalanceLookupError.fromNetworkError(chain, address, error, attempt)
}
