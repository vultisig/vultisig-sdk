import { Vault } from '@core/mpc/vault/Vault'
import { describe, expect, it, vi } from 'vitest'

import { createVaultBackup } from '../../../src/utils/export'

// Mock the external dependencies
vi.mock('@bufbuild/protobuf', () => ({
  create: vi.fn((schema, data) => data),
  toBinary: vi.fn((schema, data) => {
    // Return a mock binary representation
    // Handle BigInt by converting to string
    const replacer = (key: string, value: any) =>
      typeof value === 'bigint' ? value.toString() : value
    return Buffer.from(JSON.stringify(data, replacer))
  }),
}))

vi.mock('@core/mpc/types/utils/commVault', () => ({
  toCommVault: vi.fn(vault => ({
    name: vault.name,
    localPartyId: vault.localPartyId,
    signers: vault.signers,
  })),
}))

vi.mock('@lib/utils/encryption/aesGcm/encryptWithAesGcm', () => ({
  encryptWithAesGcm: vi.fn(({ key, value }) => {
    // Return a mock encrypted value
    return Buffer.from(`encrypted_${key}_${value.toString()}`)
  }),
}))

describe('Export Utilities', () => {
  describe('createVaultBackup', () => {
    it('should create unencrypted backup when no password provided', async () => {
      const mockVault: Vault = {
        name: 'TestVault',
        localPartyId: 'device-1',
        signers: ['device-1', 'device-2'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const backup = await createVaultBackup(mockVault)

      expect(backup).toBeDefined()
      expect(typeof backup).toBe('string')
      // Should be base64 encoded
      expect(backup).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('should create encrypted backup when password provided', async () => {
      const mockVault: Vault = {
        name: 'SecureVault',
        localPartyId: 'device-secure',
        signers: ['device-secure', 'backup'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const password = 'StrongPassword123!'
      const backup = await createVaultBackup(mockVault, password)

      expect(backup).toBeDefined()
      expect(typeof backup).toBe('string')
      // Should be base64 encoded
      expect(backup).toMatch(/^[A-Za-z0-9+/]+=*$/)
    })

    it('should create different backups for encrypted vs unencrypted', async () => {
      const mockVault: Vault = {
        name: 'Vault',
        localPartyId: 'device',
        signers: ['device', 'server'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const unencryptedBackup = await createVaultBackup(mockVault)
      const encryptedBackup = await createVaultBackup(mockVault, 'password')

      expect(unencryptedBackup).not.toBe(encryptedBackup)
    })

    it('should handle empty password as unencrypted', async () => {
      const mockVault: Vault = {
        name: 'Vault',
        localPartyId: 'device',
        signers: ['device'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const backupWithEmptyPassword = await createVaultBackup(mockVault, '')
      const backupWithoutPassword = await createVaultBackup(mockVault)

      // Both should create unencrypted backups
      expect(typeof backupWithEmptyPassword).toBe('string')
      expect(typeof backupWithoutPassword).toBe('string')
    })

    it('should return base64 encoded string', async () => {
      const mockVault: Vault = {
        name: 'EncodingTest',
        localPartyId: 'device',
        signers: ['device', 'backup'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const backup = await createVaultBackup(mockVault, 'password')

      // Should be valid base64
      expect(() => Buffer.from(backup, 'base64')).not.toThrow()

      const decoded = Buffer.from(backup, 'base64')
      expect(decoded.length).toBeGreaterThan(0)
    })

    it('should handle vault with many signers', async () => {
      const mockVault: Vault = {
        name: 'MultiSigVault',
        localPartyId: 'device-3',
        signers: ['device-1', 'device-2', 'device-3', 'device-4', 'device-5'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const backup = await createVaultBackup(mockVault, 'SecurePass')

      expect(backup).toBeDefined()
      expect(typeof backup).toBe('string')
    })

    it('should handle vault with special characters in name', async () => {
      const mockVault: Vault = {
        name: 'Vault™ (2024) - Main 🔒',
        localPartyId: 'device-unicode',
        signers: ['device-unicode', 'backup'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const backup = await createVaultBackup(mockVault)

      expect(backup).toBeDefined()
      expect(typeof backup).toBe('string')
    })

    it('should handle different password types', async () => {
      const mockVault: Vault = {
        name: 'PasswordTest',
        localPartyId: 'device',
        signers: ['device', 'server'],
        publicKeys: { ecdsa: 'test', eddsa: 'test' },
        hexChainCode: 'test',
        keyShares: { ecdsa: 'test', eddsa: 'test' },
        libType: 'GG20',
        isBackedUp: false,
        order: 0,
      }

      const passwords = [
        'simple',
        'Complex@123!',
        'very-long-password-with-many-characters-to-test-edge-cases',
        '密码', // Unicode
        '!@#$%^&*()', // Special chars only
      ]

      for (const password of passwords) {
        const backup = await createVaultBackup(mockVault, password)
        expect(backup).toBeDefined()
        expect(typeof backup).toBe('string')
      }
    })
  })
})
