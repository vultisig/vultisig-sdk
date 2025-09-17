import { describe, expect, it } from 'vitest'
import { Vultisig } from '../VultisigSDK'

describe('Vultisig static validation methods', () => {
  describe('validateEmail', () => {
    it('should validate valid emails', () => {
      expect(Vultisig.validateEmail('test@example.com')).toEqual({
        valid: true
      })
      expect(Vultisig.validateEmail('user+alias@domain.co')).toEqual({
        valid: true
      })
      expect(Vultisig.validateEmail('user.name@sub.domain.com')).toEqual({
        valid: true
      })
    })

    it('should reject invalid emails', () => {
      const result = Vultisig.validateEmail('invalid-email')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Please enter a valid email address')

      const result2 = Vultisig.validateEmail('user@')
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Please enter a valid email address')

      const result3 = Vultisig.validateEmail('')
      expect(result3.valid).toBe(false)
      expect(result3.error).toBe('Please enter a valid email address')
    })
  })

  describe('validatePassword', () => {
    it('should validate valid passwords', () => {
      expect(Vultisig.validatePassword('a')).toEqual({
        valid: true
      })
      expect(Vultisig.validatePassword('password123')).toEqual({
        valid: true
      })
      expect(Vultisig.validatePassword('a'.repeat(128))).toEqual({
        valid: true
      })
    })

    it('should reject empty passwords', () => {
      const result = Vultisig.validatePassword('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Password is required')
    })

    it('should reject passwords that are too long', () => {
      const result = Vultisig.validatePassword('a'.repeat(129))
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Password must be no more than 128 characters long')
    })

    it('should handle null/undefined passwords', () => {
      const result = Vultisig.validatePassword(null as any)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Password is required')

      const result2 = Vultisig.validatePassword(undefined as any)
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Password is required')
    })
  })

  describe('validateVaultName', () => {
    it('should validate valid vault names', () => {
      expect(Vultisig.validateVaultName('My Vault')).toEqual({
        valid: true
      })
      expect(Vultisig.validateVaultName('ab')).toEqual({
        valid: true
      })
      expect(Vultisig.validateVaultName('a'.repeat(50))).toEqual({
        valid: true
      })
    })

    it('should reject empty vault names', () => {
      const result = Vultisig.validateVaultName('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Vault name is required')

      const result2 = Vultisig.validateVaultName('   ')
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Vault name must be at least 2 characters long')
    })

    it('should reject vault names that are too short', () => {
      const result = Vultisig.validateVaultName('a')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Vault name must be at least 2 characters long')
    })

    it('should reject vault names that are too long', () => {
      const result = Vultisig.validateVaultName('a'.repeat(51))
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Vault name must be no more than 50 characters long')
    })

    it('should reject non-string vault names', () => {
      const result = Vultisig.validateVaultName(123 as any)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Vault name must be a string')

      const result2 = Vultisig.validateVaultName(null as any)
      expect(result2.valid).toBe(false)
      expect(result2.error).toBe('Vault name is required')
    })

    it('should handle whitespace correctly', () => {
      expect(Vultisig.validateVaultName('  Valid Name  ')).toEqual({
        valid: true
      })
    })
  })
})