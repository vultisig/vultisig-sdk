import { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import {
  AuthRequiredError,
  classifyError,
  ExitCode,
  ExternalServiceError,
  InsufficientBalanceError,
  InvalidAddressError,
  InvalidChainError,
  InvalidInputError,
  NetworkError,
  NoRouteError,
  PricingUnavailableError,
  toErrorJson,
  TokenNotFoundError,
  UnknownError,
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

  it('classifies ECONNREFUSED as NetworkError', () => {
    const result = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.exitCode).toBe(ExitCode.NETWORK)
    expect(result.retryable).toBe(true)
  })

  it('classifies fetch failed as NetworkError', () => {
    const result = classifyError(new Error('fetch failed'))
    expect(result).toBeInstanceOf(NetworkError)
  })

  it('classifies socket hang up as NetworkError', () => {
    const result = classifyError(new Error('socket hang up'))
    expect(result).toBeInstanceOf(NetworkError)
  })

  it('falls back to UnknownError for unrecognized errors', () => {
    const result = classifyError(new Error('Something completely different'))
    expect(result).toBeInstanceOf(UnknownError)
    expect(result.exitCode).toBe(ExitCode.UNKNOWN)
    expect(result.code).toBe('UNKNOWN_ERROR')
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
      success: false,
      v: 1,
      error: {
        code: 'INVALID_CHAIN',
        exitCode: ExitCode.INVALID_INPUT,
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
    expect(json.success).toBe(false)
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
      success: false,
      v: 1,
      error: {
        code: 'UNKNOWN_ERROR',
        exitCode: ExitCode.UNKNOWN,
        message: 'generic problem',
        retryable: false,
      },
    })
  })

  it('includes exitCode in JSON output', () => {
    const err = new NetworkError('timeout')
    const json = toErrorJson(err)
    expect(json.error.exitCode).toBe(ExitCode.NETWORK)
  })

  it('includes hint for AuthRequiredError', () => {
    const err = new AuthRequiredError()
    const json = toErrorJson(err)
    expect(json.error.code).toBe('AUTH_REQUIRED')
    expect(json.error.exitCode).toBe(ExitCode.AUTH_REQUIRED)
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

  it('UnknownError has correct properties', () => {
    const err = new UnknownError('unexpected')
    expect(err.retryable).toBe(false)
    expect(err.exitCode).toBe(ExitCode.UNKNOWN)
    expect(err.code).toBe('UNKNOWN_ERROR')
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
    expect(new UnknownError('x')).toBeInstanceOf(VsigError)
  })

  it('all errors extend Error', () => {
    expect(new UsageError('x')).toBeInstanceOf(Error)
    expect(new NetworkError('x')).toBeInstanceOf(Error)
    expect(new UnknownError('x')).toBeInstanceOf(Error)
  })
})

describe('classifyError with VaultError', () => {
  it('maps UnsupportedChain to InvalidChainError', () => {
    const err = new VaultError(VaultErrorCode.UnsupportedChain, 'chain not supported')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidChainError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.message).toBe('chain not supported')
  })

  it('maps ChainNotSupported to InvalidChainError', () => {
    const err = new VaultError(VaultErrorCode.ChainNotSupported, 'no support')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidChainError)
  })

  it('maps NetworkError to NetworkError with retryable', () => {
    const err = new VaultError(VaultErrorCode.NetworkError, 'connection failed')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.exitCode).toBe(ExitCode.NETWORK)
    expect(result.retryable).toBe(true)
  })

  it('maps BalanceFetchFailed to NetworkError', () => {
    const err = new VaultError(VaultErrorCode.BalanceFetchFailed, 'fetch failed')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.retryable).toBe(true)
  })

  it('maps Timeout to NetworkError with retryable', () => {
    const err = new VaultError(VaultErrorCode.Timeout, 'request timed out')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.retryable).toBe(true)
  })

  it('maps InvalidAmount to InvalidInputError', () => {
    const err = new VaultError(VaultErrorCode.InvalidAmount, 'bad amount')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidInputError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
  })

  it('maps InvalidConfig to UsageError', () => {
    const err = new VaultError(VaultErrorCode.InvalidConfig, 'bad config')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UsageError)
  })

  it('maps UnsupportedToken to TokenNotFoundError', () => {
    const err = new VaultError(VaultErrorCode.UnsupportedToken, 'token not supported')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(TokenNotFoundError)
    expect(result.exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
  })

  it('maps BroadcastFailed to ExternalServiceError', () => {
    const err = new VaultError(VaultErrorCode.BroadcastFailed, 'broadcast failed')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(ExternalServiceError)
    expect(result.exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
    expect(result.retryable).toBe(true)
  })

  it('maps GasEstimationFailed to InvalidInputError', () => {
    const err = new VaultError(VaultErrorCode.GasEstimationFailed, 'gas error')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidInputError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
  })

  it('maps SigningFailed to UnknownError', () => {
    const err = new VaultError(VaultErrorCode.SigningFailed, 'sign failed')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UnknownError)
    expect(result.exitCode).toBe(ExitCode.UNKNOWN)
  })

  it('maps unhandled codes to UnknownError', () => {
    const err = new VaultError(VaultErrorCode.InvalidVault, 'bad vault')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UnknownError)
  })

  it('takes priority over string matching', () => {
    const err = new VaultError(VaultErrorCode.InvalidAmount, 'unsupported chain in amount')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidInputError)
  })
})

describe('classifyError with VaultImportError', () => {
  it('maps PASSWORD_REQUIRED to AuthRequiredError', () => {
    const err = new VaultImportError(VaultImportErrorCode.PASSWORD_REQUIRED, 'password needed')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(AuthRequiredError)
    expect(result.exitCode).toBe(ExitCode.AUTH_REQUIRED)
  })

  it('maps INVALID_PASSWORD to AuthRequiredError', () => {
    const err = new VaultImportError(VaultImportErrorCode.INVALID_PASSWORD, 'wrong password')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(AuthRequiredError)
  })

  it('maps INVALID_FILE_FORMAT to UsageError', () => {
    const err = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'bad file')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UsageError)
    expect(result.exitCode).toBe(ExitCode.USAGE)
  })

  it('maps CORRUPTED_DATA to UsageError', () => {
    const err = new VaultImportError(VaultImportErrorCode.CORRUPTED_DATA, 'corrupted')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UsageError)
  })

  it('maps UNSUPPORTED_FORMAT to UsageError', () => {
    const err = new VaultImportError(VaultImportErrorCode.UNSUPPORTED_FORMAT, 'unsupported')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(UsageError)
  })
})
