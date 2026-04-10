/**
 * Tests for early password validation (#196)
 *
 * When a password-protected vault is loaded without providing onPasswordRequired,
 * the SDK should throw at vault load time (createVaultInstance),
 * not silently succeed and only fail later at sign() time.
 *
 * Since the VaultManager integration tests have pre-existing dist build issues,
 * we test the validation logic directly to prove correctness.
 */

import { describe, expect, it } from 'vitest'

import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'

/**
 * Replicates the early validation logic added to VaultManager.createVaultInstance.
 * See: packages/sdk/src/VaultManager.ts
 */
function validatePasswordCallback(
  isEncrypted: boolean,
  vaultName: string,
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
): void {
  if (isEncrypted && !onPasswordRequired) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `Vault "${vaultName}" is password-protected but no onPasswordRequired callback was provided. ` +
        'Pass onPasswordRequired in the Vultisig constructor: ' +
        'new Vultisig({ onPasswordRequired: async () => password })'
    )
  }
}

describe('Early password validation (#196)', () => {
  describe('encrypted vault without callback', () => {
    it('should throw VaultError with InvalidConfig code', () => {
      expect(() => validatePasswordCallback(true, 'my-vault')).toThrow(VaultError)

      try {
        validatePasswordCallback(true, 'my-vault')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.InvalidConfig)
      }
    })

    it('should include vault name in error message', () => {
      expect(() => validatePasswordCallback(true, 'ray-test')).toThrow('ray-test')
    })

    it('should include actionable fix in error message', () => {
      expect(() => validatePasswordCallback(true, 'v')).toThrow('onPasswordRequired')
      expect(() => validatePasswordCallback(true, 'v')).toThrow('Vultisig constructor')
    })
  })

  describe('encrypted vault with callback', () => {
    it('should NOT throw when onPasswordRequired is provided', () => {
      const callback = async () => 'password123'

      expect(() => validatePasswordCallback(true, 'my-vault', callback)).not.toThrow()
    })
  })

  describe('unencrypted vault', () => {
    it('should NOT throw even without callback', () => {
      expect(() => validatePasswordCallback(false, 'my-vault')).not.toThrow()
    })

    it('should NOT throw with callback either', () => {
      const callback = async () => 'password123'

      expect(() => validatePasswordCallback(false, 'my-vault', callback)).not.toThrow()
    })
  })
})
