import { describe, expect, it } from 'vitest'

import { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from '../../../src/vault/VaultError'

describe('VaultError', () => {
  describe('constructor', () => {
    it('should create error with correct code and message', () => {
      const error = new VaultError(VaultErrorCode.InvalidConfig, 'Configuration is invalid')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(VaultError)
      expect(error.code).toBe(VaultErrorCode.InvalidConfig)
      expect(error.message).toBe('Configuration is invalid')
      expect(error.name).toBe('VaultError')
    })

    it('should wrap underlying errors', () => {
      const cause = new Error('Network timeout')
      const error = new VaultError(VaultErrorCode.NetworkError, 'Failed to connect to server', cause)

      expect(error.code).toBe(VaultErrorCode.NetworkError)
      expect(error.message).toBe('Failed to connect to server')
      expect(error.originalError).toBe(cause)
      expect(error.originalError?.message).toBe('Network timeout')
    })

    it('should handle error without original error', () => {
      const error = new VaultError(VaultErrorCode.SigningFailed, 'Signature generation failed')

      expect(error.originalError).toBeUndefined()
    })

    it('should maintain proper stack trace', () => {
      const error = new VaultError(VaultErrorCode.InvalidVault, 'Vault data is corrupted')

      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('VaultError')
    })
  })

  describe('error codes', () => {
    it('should support all defined error codes', () => {
      const errorCodes = [
        VaultErrorCode.InvalidConfig,
        VaultErrorCode.SigningFailed,
        VaultErrorCode.NotImplemented,
        VaultErrorCode.AddressDerivationFailed,
        VaultErrorCode.WalletCoreNotInitialized,
        VaultErrorCode.UnsupportedChain,
        VaultErrorCode.ChainNotSupported,
        VaultErrorCode.NetworkError,
        VaultErrorCode.InvalidVault,
        VaultErrorCode.InvalidPublicKey,
        VaultErrorCode.InvalidChainCode,
        VaultErrorCode.BalanceFetchFailed,
        VaultErrorCode.UnsupportedToken,
        VaultErrorCode.GasEstimationFailed,
      ]

      errorCodes.forEach(code => {
        const error = new VaultError(code, `Test error for ${code}`)
        expect(error.code).toBe(code)
      })
    })

    it('should use specific error codes for different scenarios', () => {
      const configError = new VaultError(VaultErrorCode.InvalidConfig, 'Invalid configuration')
      expect(configError.code).toBe('INVALID_CONFIG')

      const signingError = new VaultError(VaultErrorCode.SigningFailed, 'Signature failed')
      expect(signingError.code).toBe('SIGNING_FAILED')

      const networkError = new VaultError(VaultErrorCode.NetworkError, 'Network error')
      expect(networkError.code).toBe('NETWORK_ERROR')
    })
  })

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const error = new VaultError(VaultErrorCode.InvalidPublicKey, 'Invalid public key provided')

      const json = error.toJSON()

      expect(json.name).toBe('VaultError')
      expect(json.code).toBe(VaultErrorCode.InvalidPublicKey)
      expect(json.message).toBe('Invalid public key provided')
      expect(json.stack).toBeDefined()
    })

    it('should include original error in JSON', () => {
      const original = new Error('Original error message')
      const error = new VaultError(VaultErrorCode.SigningFailed, 'Wrapper error', original)

      const json = error.toJSON()

      expect(json.originalError).toBe('Original error message')
    })

    it('should not include originalError when none exists', () => {
      const error = new VaultError(VaultErrorCode.NotImplemented, 'Feature not implemented')

      const json = error.toJSON()

      expect(json.originalError).toBeUndefined()
    })

    it('should be stringifiable', () => {
      const error = new VaultError(VaultErrorCode.BalanceFetchFailed, 'Failed to fetch balance')

      const stringified = JSON.stringify(error)
      const parsed = JSON.parse(stringified)

      expect(parsed.name).toBe('VaultError')
      expect(parsed.code).toBe(VaultErrorCode.BalanceFetchFailed)
      expect(parsed.message).toBe('Failed to fetch balance')
    })
  })

  describe('error handling scenarios', () => {
    it('should handle address derivation errors', () => {
      const error = new VaultError(VaultErrorCode.AddressDerivationFailed, 'Failed to derive address for Bitcoin')

      expect(error.code).toBe(VaultErrorCode.AddressDerivationFailed)
      expect(error.message).toContain('Bitcoin')
    })

    it('should handle unsupported chain errors', () => {
      const error = new VaultError(VaultErrorCode.UnsupportedChain, 'Chain "MyCustomChain" is not supported')

      expect(error.code).toBe(VaultErrorCode.UnsupportedChain)
      expect(error.message).toContain('MyCustomChain')
    })

    it('should handle wallet core initialization errors', () => {
      const wasmError = new Error('Failed to load WASM module')
      const error = new VaultError(
        VaultErrorCode.WalletCoreNotInitialized,
        'WalletCore has not been initialized',
        wasmError
      )

      expect(error.code).toBe(VaultErrorCode.WalletCoreNotInitialized)
      expect(error.originalError).toBe(wasmError)
    })

    it('should handle gas estimation failures', () => {
      const error = new VaultError(VaultErrorCode.GasEstimationFailed, 'Failed to estimate gas for transaction')

      expect(error.code).toBe(VaultErrorCode.GasEstimationFailed)
    })
  })

  describe('instanceof checks', () => {
    it('should be instanceof Error', () => {
      const error = new VaultError(VaultErrorCode.InvalidVault, 'Test')
      expect(error instanceof Error).toBe(true)
    })

    it('should be instanceof VaultError', () => {
      const error = new VaultError(VaultErrorCode.InvalidVault, 'Test')
      expect(error instanceof VaultError).toBe(true)
    })

    it('should not be instanceof other error types', () => {
      const error = new VaultError(VaultErrorCode.InvalidVault, 'Test')
      expect(error instanceof TypeError).toBe(false)
      expect(error instanceof RangeError).toBe(false)
    })
  })
})

describe('VaultImportError', () => {
  describe('constructor', () => {
    it('should create import error with correct code and message', () => {
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'File format is not recognized')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(VaultImportError)
      expect(error.code).toBe(VaultImportErrorCode.INVALID_FILE_FORMAT)
      expect(error.message).toBe('File format is not recognized')
      expect(error.name).toBe('VaultImportError')
    })

    it('should wrap underlying errors', () => {
      const cause = new Error('Decryption failed')
      const error = new VaultImportError(VaultImportErrorCode.INVALID_PASSWORD, 'Password is incorrect', cause)

      expect(error.code).toBe(VaultImportErrorCode.INVALID_PASSWORD)
      expect(error.originalError).toBe(cause)
    })
  })

  describe('import error codes', () => {
    it('should support all import error codes', () => {
      const errorCodes = [
        VaultImportErrorCode.INVALID_FILE_FORMAT,
        VaultImportErrorCode.PASSWORD_REQUIRED,
        VaultImportErrorCode.INVALID_PASSWORD,
        VaultImportErrorCode.CORRUPTED_DATA,
        VaultImportErrorCode.UNSUPPORTED_FORMAT,
      ]

      errorCodes.forEach(code => {
        const error = new VaultImportError(code, `Test import error for ${code}`)
        expect(error.code).toBe(code)
      })
    })

    it('should differentiate between password errors', () => {
      const passwordRequired = new VaultImportError(
        VaultImportErrorCode.PASSWORD_REQUIRED,
        'Vault is encrypted, password required'
      )
      expect(passwordRequired.code).toBe('PASSWORD_REQUIRED')

      const invalidPassword = new VaultImportError(VaultImportErrorCode.INVALID_PASSWORD, 'Password is incorrect')
      expect(invalidPassword.code).toBe('INVALID_PASSWORD')
    })
  })

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const error = new VaultImportError(VaultImportErrorCode.CORRUPTED_DATA, 'Vault data is corrupted')

      const json = error.toJSON()

      expect(json.name).toBe('VaultImportError')
      expect(json.code).toBe(VaultImportErrorCode.CORRUPTED_DATA)
      expect(json.message).toBe('Vault data is corrupted')
      expect(json.stack).toBeDefined()
    })

    it('should include original error in JSON', () => {
      const original = new Error('Base64 decode failed')
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'Invalid base64 encoding', original)

      const json = error.toJSON()

      expect(json.originalError).toBe('Base64 decode failed')
    })
  })

  describe('import scenarios', () => {
    it('should handle invalid file format', () => {
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'File is not a valid .vult file')

      expect(error.code).toBe(VaultImportErrorCode.INVALID_FILE_FORMAT)
    })

    it('should handle password requirement', () => {
      const error = new VaultImportError(
        VaultImportErrorCode.PASSWORD_REQUIRED,
        'This vault backup is encrypted and requires a password'
      )

      expect(error.code).toBe(VaultImportErrorCode.PASSWORD_REQUIRED)
    })

    it('should handle corrupted vault data', () => {
      const error = new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        'Vault data is corrupted and cannot be recovered'
      )

      expect(error.code).toBe(VaultImportErrorCode.CORRUPTED_DATA)
    })

    it('should handle unsupported format versions', () => {
      const error = new VaultImportError(
        VaultImportErrorCode.UNSUPPORTED_FORMAT,
        'Vault format version 3 is not supported by this SDK version'
      )

      expect(error.code).toBe(VaultImportErrorCode.UNSUPPORTED_FORMAT)
      expect(error.message).toContain('version 3')
    })
  })

  describe('instanceof checks', () => {
    it('should be instanceof Error', () => {
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'Test')
      expect(error instanceof Error).toBe(true)
    })

    it('should be instanceof VaultImportError', () => {
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'Test')
      expect(error instanceof VaultImportError).toBe(true)
    })

    it('should not be instanceof VaultError', () => {
      const error = new VaultImportError(VaultImportErrorCode.INVALID_FILE_FORMAT, 'Test')
      expect(error instanceof VaultError).toBe(false)
    })
  })
})

describe('Error code enums', () => {
  it('should have unique VaultErrorCode values', () => {
    const codes = Object.values(VaultErrorCode)
    const uniqueCodes = new Set(codes)

    expect(codes.length).toBe(uniqueCodes.size)
  })

  it('should have unique VaultImportErrorCode values', () => {
    const codes = Object.values(VaultImportErrorCode)
    const uniqueCodes = new Set(codes)

    expect(codes.length).toBe(uniqueCodes.size)
  })

  it('should use SCREAMING_SNAKE_CASE for error codes', () => {
    const vaultCodes = Object.values(VaultErrorCode)
    vaultCodes.forEach(code => {
      expect(code).toMatch(/^[A-Z_]+$/)
    })

    const importCodes = Object.values(VaultImportErrorCode)
    importCodes.forEach(code => {
      expect(code).toMatch(/^[A-Z_]+$/)
    })
  })
})
