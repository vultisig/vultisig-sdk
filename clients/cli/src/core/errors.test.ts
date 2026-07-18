import { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from '@vultisig/sdk'
import { describe, expect, it } from 'vitest'

import {
  AuthRequiredError,
  classifyError,
  ConfirmationRequiredError,
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

  // The vault-free prep helpers (tools/prep/send.ts:60) throw this wording as a
  // plain Error, which `includes('invalid address')` does not match.
  it('classifies "Invalid receiver address" plain errors', () => {
    const result = classifyError(new Error('Invalid receiver address for chain Ethereum: 0xdeadbeef'))
    expect(result).toBeInstanceOf(InvalidAddressError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
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

describe('ConfirmationRequiredError', () => {
  it('has a stable code and dedicated exit code (not UNKNOWN/7)', () => {
    const err = new ConfirmationRequiredError('Transaction requires confirmation.', 'Pass --yes to confirm.')
    expect(err).toBeInstanceOf(VsigError)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('CONFIRMATION_REQUIRED')
    expect(err.exitCode).toBe(ExitCode.CONFIRMATION_REQUIRED)
    expect(err.exitCode).not.toBe(ExitCode.UNKNOWN)
    expect(err.retryable).toBe(false)
    expect(err.hint).toBe('Pass --yes to confirm.')
  })

  it('is returned unchanged by classifyError', () => {
    const original = new ConfirmationRequiredError('needs confirmation')
    expect(classifyError(original)).toBe(original)
  })

  it('serializes to a stable JSON envelope', () => {
    const json = toErrorJson(new ConfirmationRequiredError('Swap requires confirmation.', 'Pass --yes to confirm.'))
    expect(json).toEqual({
      success: false,
      v: 1,
      error: {
        code: 'CONFIRMATION_REQUIRED',
        exitCode: ExitCode.CONFIRMATION_REQUIRED,
        message: 'Swap requires confirmation.',
        hint: 'Pass --yes to confirm.',
        retryable: false,
      },
    })
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

  it('unwraps BalanceFetchFailed to reveal inner invalid-chain error', () => {
    const inner = new VaultError(VaultErrorCode.InvalidConfig, 'Unknown chain: "ethreum". Available: [Ethereum]')
    const wrapped = new VaultError(
      VaultErrorCode.BalanceFetchFailed,
      'Failed to fetch balance for ethreum: VaultError: Unknown chain: "ethreum"',
      inner
    )
    const result = classifyError(wrapped)
    expect(result).toBeInstanceOf(InvalidChainError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
    expect(result.context).toEqual({ chain: 'ethreum' })
  })

  it('maps InvalidConfig with "Unknown chain" message to InvalidChainError', () => {
    const err = new VaultError(VaultErrorCode.InvalidConfig, 'Unknown chain: "foo". Available: [Ethereum]')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidChainError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
  })

  // `send` raises InvalidConfig for a bad receiver (VaultBase.ts:1051) while
  // address-book already reported INVALID_ADDRESS/4 for the same class. The
  // README documents 4, so the UsageError/1 default was a documented-vs-actual lie.
  it('maps InvalidConfig with an "Invalid receiver address" message to InvalidAddressError/4', () => {
    const err = new VaultError(VaultErrorCode.InvalidConfig, 'Invalid receiver address for chain Ethereum: 0xdeadbeef')
    const result = classifyError(err)
    expect(result).toBeInstanceOf(InvalidAddressError)
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
    expect(result.context).toMatchObject({ address: '0xdeadbeef' })
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

describe('anticipated CLI taxonomy regressions', () => {
  it.each([
    ['No vault found matching: missing', 'VAULT_NOT_FOUND', ExitCode.RESOURCE_NOT_FOUND],
    ['Vault not found: "missing"', 'VAULT_NOT_FOUND', ExitCode.RESOURCE_NOT_FOUND],
    ['Invalid currency', 'INVALID_INPUT', ExitCode.INVALID_INPUT],
    ['Invalid amount', 'INVALID_INPUT', ExitCode.INVALID_INPUT],
    ['Invalid mnemonic phrase', 'INVALID_INPUT', ExitCode.INVALID_INPUT],
    ['signBytes failed: message must be 32 bytes', 'INVALID_INPUT', ExitCode.INVALID_INPUT],
  ])('maps %s to %s / exit %i', (message, code, exitCode) => {
    const result = classifyError(new Error(message))
    expect(result.code).toBe(code)
    expect(result.exitCode).toBe(exitCode)
    expect(result.retryable).toBe(false)
  })

  it('maps filesystem ENOENT to non-retryable invalid input', () => {
    const err = Object.assign(new Error("ENOENT: no such file or directory, open '/tmp/missing.vult'"), {
      code: 'ENOENT',
    })
    const result = classifyError(err)
    expect(result.code).toBe('INVALID_INPUT')
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
  })

  it('maps SDK VaultNotFound to exit 5', () => {
    const result = classifyError(new VaultError(VaultErrorCode.VaultNotFound, 'Vault missing was not found'))
    expect(result.code).toBe('VAULT_NOT_FOUND')
    expect(result.exitCode).toBe(ExitCode.RESOURCE_NOT_FOUND)
  })

  it('maps sign-time wrong password to the same auth slot as import wrong password', () => {
    const signError = new VaultError(VaultErrorCode.InvalidConfig, 'Failed to unlock vault: invalid password')
    const importError = new VaultImportError(VaultImportErrorCode.INVALID_PASSWORD, 'wrong password')
    expect(classifyError(signError).exitCode).toBe(ExitCode.AUTH_REQUIRED)
    expect(classifyError(importError).exitCode).toBe(ExitCode.AUTH_REQUIRED)
  })

  it('maps permanent raw-transaction decode rejection to invalid input without retry advice', () => {
    const err = new VaultError(
      VaultErrorCode.BroadcastFailed,
      'Failed to broadcast raw transaction on Ethereum: failed to decode signed transaction'
    )
    const result = classifyError(err)
    expect(result.code).toBe('INVALID_INPUT')
    expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
    expect(result.retryable).toBe(false)
    expect(result.suggestions).toBeUndefined()
  })

  it('keeps transient broadcast failures retryable', () => {
    const result = classifyError(
      new VaultError(VaultErrorCode.BroadcastFailed, 'Failed to broadcast raw transaction on Ethereum: RPC unavailable')
    )
    expect(result.code).toBe('EXTERNAL_SERVICE')
    expect(result.exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
    expect(result.retryable).toBe(true)
  })

  describe('non-EVM permanent broadcast rejections', () => {
    const expectPermanent = (err: VaultError) => {
      const result = classifyError(err)
      expect(result.code).toBe('INVALID_INPUT')
      expect(result.exitCode).toBe(ExitCode.INVALID_INPUT)
      expect(result.retryable).toBe(false)
      expect(result.suggestions).toBeUndefined()
    }

    const expectTransient = (err: VaultError) => {
      const result = classifyError(err)
      expect(result.code).toBe('EXTERNAL_SERVICE')
      expect(result.exitCode).toBe(ExitCode.EXTERNAL_SERVICE)
      expect(result.retryable).toBe(true)
    }

    it.each([
      ['-26', 'mandatory-script-verify-flag-failed'],
      ['-27', 'transaction already in block chain'],
    ])('maps a UTXO bitcoind %s rejection preserved by Blockchair to non-retryable input', (code, reason) => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Failed to broadcast raw transaction on Bitcoin: Failed to broadcast transaction: RPC error ${code}: ${reason}`
        )
      )
    })

    it('maps a UTXO decode rejection preserved by Blockchair to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast raw transaction on Bitcoin: Failed to broadcast transaction: TX decode failed'
        )
      )
    })

    it('keeps a UTXO Blockchair transport failure retryable', () => {
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast raw transaction on Bitcoin: HTTP 503 Service Unavailable'
        )
      )
    })

    it('maps a Solana preflight deserialize rejection to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Solana: Simulation failed. Message: failed to deserialize transaction'
        )
      )
    })

    it('maps the Solana raw-broadcast base58 decoder rejection to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast raw transaction on Solana: Non-base58 character'
        )
      )
    })

    it('keeps a Solana blockhash miss retryable after the resolver exhausts its bounded retries', () => {
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Solana: Simulation failed. Message: BlockhashNotFound'
        )
      )
    })

    it('maps a Sui transaction-execution client rejection to non-retryable input', () => {
      const rpcError = Object.assign(new Error('Invalid user signature: cryptographic signature verification failed'), {
        code: -32002,
      })
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Failed to broadcast transaction on Sui: ${rpcError.message}`,
          rpcError
        )
      )
    })

    it('maps the Sui raw-broadcast required-fields guard to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Sui broadcast requires JSON with "unsignedTx" and "signature" fields'
        )
      )
    })

    it('keeps a Sui server-busy JSON-RPC failure retryable', () => {
      const rpcError = Object.assign(new Error('Server busy'), { code: -32604 })
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Failed to broadcast transaction on Sui: ${rpcError.message}`,
          rpcError
        )
      )
    })

    it('keeps a Sui -32002 rejection retryable when the message is not a recognized permanent signal', () => {
      // -32002 (TransactionExecutionClientError) is a broad bucket covering more than
      // signature failures — an unrecognized message under that code must not be
      // blanket-matched to permanent.
      const rpcError = Object.assign(new Error('Insufficient gas budget for this transaction'), { code: -32002 })
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          `Failed to broadcast transaction on Sui: ${rpcError.message}`,
          rpcError
        )
      )
    })

    it('maps a Cosmos ABCI CheckTx rejection to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Cosmos: Broadcasting transaction failed with code 2 (codespace: sdk). Log: tx parse error'
        )
      )
    })

    it('maps a Cosmos insufficient-funds rejection to non-retryable input', () => {
      expectPermanent(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Cosmos: Broadcasting transaction failed with code 5 (codespace: sdk). Log: 100000uatom is smaller than 500000uatom: insufficient funds'
        )
      )
    })

    it('keeps a Cosmos account-sequence-mismatch rejection retryable', () => {
      // Code 32 ("incorrect account sequence") is not in the permanent allowlist — a
      // gap in the account's sequence is a transient MPC-race shape that can resolve
      // once the intervening sequence lands, so the identical signed bytes may still
      // succeed on a later attempt.
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Cosmos: Broadcasting transaction failed with code 32 (codespace: sdk). Log: account sequence mismatch, expected 5, got 4: incorrect account sequence'
        )
      )
    })

    it('keeps a Cosmos rejection from a non-root codespace retryable', () => {
      // A module-specific codespace (e.g. wasm) can reuse root-codespace-style
      // numeric codes for unrelated conditions, so the allowlist only applies to
      // "codespace: sdk".
      expectTransient(
        new VaultError(
          VaultErrorCode.BroadcastFailed,
          'Failed to broadcast transaction on Cosmos: Broadcasting transaction failed with code 5 (codespace: wasm). Log: execute wasm contract failed'
        )
      )
    })

    it('keeps a Cosmos RPC transport failure retryable', () => {
      expectTransient(
        new VaultError(VaultErrorCode.BroadcastFailed, 'Failed to broadcast transaction on Cosmos: request timed out')
      )
    })
  })
})
