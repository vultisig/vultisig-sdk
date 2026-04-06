import { describe, expect, it } from 'vitest'

import {
  AuthRequiredError,
  classifyError,
  ExitCode,
  InsufficientBalanceError,
  InvalidAddressError,
  InvalidChainError,
  NetworkError,
  NoRouteError,
  PricingUnavailableError,
  toErrorJson,
  TokenNotFoundError,
  UsageError,
  VsigError,
} from './errors'

describe('classifyError', () => {
  it('returns VsigError instances unchanged', () => {
    const original = new InvalidChainError('bad chain')
    expect(classifyError(original)).toBe(original)
  })

  it('classifies unsupported chain errors', () => {
    const result = classifyError(new Error('Unsupported chain: FOO'))
    expect(result).toBeInstanceOf(InvalidChainError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.code).toBe('INVALID_CHAIN')
  })

  it('classifies invalid chain errors', () => {
    const result = classifyError(new Error('Invalid chain specified'))
    expect(result).toBeInstanceOf(InvalidChainError)
  })

  it('classifies unknown chain errors', () => {
    const result = classifyError(new Error('Unknown chain id'))
    expect(result).toBeInstanceOf(InvalidChainError)
  })

  it('classifies invalid address errors', () => {
    const result = classifyError(new Error('Invalid address format'))
    expect(result).toBeInstanceOf(InvalidAddressError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.code).toBe('INVALID_ADDRESS')
  })

  it('classifies bad address errors', () => {
    const result = classifyError(new Error('Bad address provided'))
    expect(result).toBeInstanceOf(InvalidAddressError)
  })

  it('classifies malformed address errors', () => {
    const result = classifyError(new Error('Malformed address'))
    expect(result).toBeInstanceOf(InvalidAddressError)
  })

  it('classifies insufficient balance errors', () => {
    const result = classifyError(new Error('Insufficient balance for transfer'))
    expect(result).toBeInstanceOf(InsufficientBalanceError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.code).toBe('INSUFFICIENT_BALANCE')
  })

  it('classifies no route errors', () => {
    const result = classifyError(new Error('No route found for this pair'))
    expect(result).toBeInstanceOf(NoRouteError)
    expect(result.exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
  })

  it('classifies no swap errors', () => {
    const result = classifyError(new Error('No swap available'))
    expect(result).toBeInstanceOf(NoRouteError)
  })

  it('classifies no provider errors', () => {
    const result = classifyError(new Error('No provider for this route'))
    expect(result).toBeInstanceOf(NoRouteError)
  })

  it('classifies token not found errors', () => {
    const result = classifyError(new Error('Token not found: FAKECOIN'))
    expect(result).toBeInstanceOf(TokenNotFoundError)
    expect(result.exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
    expect(result.code).toBe('TOKEN_NOT_FOUND')
  })

  it('classifies unknown token errors', () => {
    const result = classifyError(new Error('Unknown token identifier'))
    expect(result).toBeInstanceOf(TokenNotFoundError)
  })

  it('classifies pricing errors', () => {
    const result = classifyError(new Error('Pricing data unavailable'))
    expect(result).toBeInstanceOf(PricingUnavailableError)
    expect(result.exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
    expect(result.retryable).toBe(true)
  })

  it('classifies price unavailable errors', () => {
    const result = classifyError(new Error('Price unavailable for ETH'))
    expect(result).toBeInstanceOf(PricingUnavailableError)
  })

  it('classifies price service errors', () => {
    const result = classifyError(new Error('Price service timeout'))
    expect(result).toBeInstanceOf(PricingUnavailableError)
  })

  it('falls back to UsageError for unrecognized errors', () => {
    const result = classifyError(new Error('Something completely different'))
    expect(result).toBeInstanceOf(UsageError)
    expect(result.exitCode).toBe(ExitCode.USAGE)
    expect(result.code).toBe('USAGE_ERROR')
  })

  it('is case-insensitive', () => {
    expect(classifyError(new Error('INVALID CHAIN'))).toBeInstanceOf(InvalidChainError)
    expect(classifyError(new Error('INSUFFICIENT BALANCE'))).toBeInstanceOf(InsufficientBalanceError)
    expect(classifyError(new Error('TOKEN NOT FOUND'))).toBeInstanceOf(TokenNotFoundError)
  })
})

describe('toErrorJson', () => {
  it('formats VsigError with all fields', () => {
    const err = new InvalidChainError('bad chain', 'Use a supported chain', ['vsig chains'])
    const json = toErrorJson(err)
    expect(json).toEqual({
      ok: false,
      v: 1,
      error: {
        code: 'INVALID_CHAIN',
        message: 'bad chain',
        hint: 'Use a supported chain',
        suggestions: ['vsig chains'],
        retryable: false,
      },
    })
  })

  it('formats VsigError without optional fields', () => {
    const err = new UsageError('bad args')
    const json = toErrorJson(err)
    expect(json.ok).toBe(false)
    expect(json.v).toBe(1)
    expect(json.error.code).toBe('USAGE_ERROR')
    expect(json.error.message).toBe('bad args')
    expect(json.error.retryable).toBe(false)
    expect(json.error.suggestions).toBeUndefined()
  })

  it('formats retryable errors', () => {
    const err = new NetworkError('timeout')
    const json = toErrorJson(err)
    expect(json.error.retryable).toBe(true)
    expect(json.error.code).toBe('NETWORK_ERROR')
  })

  it('formats plain Error as UNKNOWN_ERROR', () => {
    const err = new Error('generic problem')
    const json = toErrorJson(err)
    expect(json).toEqual({
      ok: false,
      v: 1,
      error: {
        code: 'UNKNOWN_ERROR',
        message: 'generic problem',
        retryable: false,
      },
    })
  })

  it('includes hint for AuthRequiredError', () => {
    const err = new AuthRequiredError()
    const json = toErrorJson(err)
    expect(json.error.code).toBe('AUTH_REQUIRED')
    expect(json.error.hint).toBe('Ensure your vault is unlocked')
    expect(json.error.suggestions).toEqual(['vsig vaults', 'vsig create'])
  })
})

describe('error class properties', () => {
  it('NetworkError is retryable', () => {
    const err = new NetworkError('timeout')
    expect(err.retryable).toBe(true)
    expect(err.exitCode).toBe(ExitCode.NETWORK)
  })

  it('PricingUnavailableError is retryable', () => {
    const err = new PricingUnavailableError('no price')
    expect(err.retryable).toBe(true)
    expect(err.exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
  })

  it('UsageError is not retryable', () => {
    const err = new UsageError('bad args')
    expect(err.retryable).toBe(false)
  })

  it('all errors extend VsigError', () => {
    expect(new UsageError('x')).toBeInstanceOf(VsigError)
    expect(new AuthRequiredError()).toBeInstanceOf(VsigError)
    expect(new NetworkError('x')).toBeInstanceOf(VsigError)
    expect(new InvalidChainError('x')).toBeInstanceOf(VsigError)
    expect(new InvalidAddressError('x')).toBeInstanceOf(VsigError)
    expect(new InsufficientBalanceError('x')).toBeInstanceOf(VsigError)
    expect(new NoRouteError('x')).toBeInstanceOf(VsigError)
    expect(new TokenNotFoundError('x')).toBeInstanceOf(VsigError)
    expect(new PricingUnavailableError('x')).toBeInstanceOf(VsigError)
  })

  it('all errors extend Error', () => {
    expect(new UsageError('x')).toBeInstanceOf(Error)
    expect(new NetworkError('x')).toBeInstanceOf(Error)
  })
})
