/**
 * VaultManager Tests - Phase 2 Task 2.3
 * Comprehensive unit tests for the VaultManager class
 *
 * TESTING STRATEGY: Tests vault lifecycle management
 * - Vault creation (fast/secure)
 * - Import/export operations
 * - Vault storage and retrieval
 * - Active vault management
 * - Error handling and edge cases
 *
 * Test Coverage:
 * - Vault creation and initialization
 * - Import from .vult files (encrypted/unencrypted)
 * - Vault listing and retrieval
 * - Active vault management
 * - Vault deletion
 * - Error scenarios and validation
 */

import { create, toBinary } from '@bufbuild/protobuf'
import { timestampNow } from '@bufbuild/protobuf/wkt'
import { Chain } from '@core/chain/Chain'
import { LibType } from '@core/mpc/types/vultisig/keygen/v1/lib_type_message_pb'
import {
  VaultContainer,
  VaultContainerSchema,
} from '@core/mpc/types/vultisig/vault/v1/vault_container_pb'
import {
  type Vault as VaultProto,
  Vault_KeyShareSchema,
  VaultSchema,
} from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { base64Encode } from '@lib/utils/base64Encode'
import { encryptWithAesGcm } from '@lib/utils/encryption/aesGcm/encryptWithAesGcm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ServerManager } from '../../../src/server/ServerManager'
import type { Vault } from '../../../src/types'
import {
  VaultImportError,
  VaultImportErrorCode,
} from '../../../src/vault/VaultError'
import { VaultManager } from '../../../src/VaultManager'
import { WASMManager } from '../../../src/wasm/WASMManager'

// Mock modules
vi.mock('@lib/utils/file/initiateFileDownload', () => ({
  initiateFileDownload: vi.fn(),
}))

// Helper to create a mock Vault protobuf object
function createMockVaultProtobuf(overrides?: any) {
  const publicKeyEcdsa =
    overrides?.publicKeyEcdsa ??
    '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc'
  const publicKeyEddsa =
    overrides?.publicKeyEddsa ??
    'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e'

  const fields: any = {
    name: overrides?.name ?? 'Test Vault',
    publicKeyEcdsa,
    publicKeyEddsa,
    signers: overrides?.signers ?? ['local-party-1', 'Server-1'],
    hexChainCode:
      overrides?.hexChainCode ??
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    keyShares: overrides?.keyShares ?? [
      // CRITICAL: fromCommVault requires keyShares for both ECDSA and EdDSA
      create(Vault_KeyShareSchema, {
        publicKey: publicKeyEcdsa,
        keyshare: 'mock_ecdsa_keyshare_data',
      }),
      create(Vault_KeyShareSchema, {
        publicKey: publicKeyEddsa,
        keyshare: 'mock_eddsa_keyshare_data',
      }),
    ],
    localPartyId: overrides?.localPartyId ?? 'local-party-1',
    resharePrefix: overrides?.resharePrefix ?? '',
    libType: overrides?.libType ?? LibType.GG20,
  }

  // Only add createdAt if provided, since it's optional
  if (overrides?.createdAt !== undefined) {
    fields.createdAt = overrides.createdAt
  } else {
    fields.createdAt = timestampNow()
  }

  return create(VaultSchema, fields)
}

// Helper to create a mock .vult file
function createMockVaultFile(
  vaultProtobuf: VaultProto,
  encrypted = false,
  password?: string
): File {
  // Serialize inner Vault protobuf
  const vaultBinary = toBinary(VaultSchema, vaultProtobuf)
  let vaultBase64 = base64Encode(vaultBinary)

  // Create VaultContainer
  let container: VaultContainer

  if (encrypted && password) {
    // Encrypt the vault data
    const encryptedData = encryptWithAesGcm({
      key: password,
      value: Buffer.from(vaultBinary),
    })

    // Store encrypted data as base64
    vaultBase64 = base64Encode(encryptedData)

    container = create(VaultContainerSchema, {
      version: BigInt(1),
      vault: vaultBase64,
      isEncrypted: true,
    })
  } else {
    container = create(VaultContainerSchema, {
      version: BigInt(1),
      vault: vaultBase64,
      isEncrypted: false,
    })
  }

  // Serialize VaultContainer to protobuf
  const containerBinary = toBinary(VaultContainerSchema, container)

  // Encode as base64 (outer layer)
  const containerBase64 = base64Encode(containerBinary)

  // Create a File object (using Buffer in Node.js environment)
  const fileContent = new TextEncoder().encode(containerBase64)
  const blob = new Blob([fileContent], { type: 'application/octet-stream' })

  // Create a File-like object with buffer for testing
  const file = new File([blob], 'test-vault.vult', {
    type: 'application/octet-stream',
  })

  // Add buffer property for Node.js test environment compatibility
  ;(file as any).buffer = fileContent

  return file
}

describe('VaultManager', () => {
  let vaultManager: VaultManager
  let mockWasmManager: WASMManager
  let mockServerManager: ServerManager

  beforeEach(() => {
    // Create mock dependencies
    mockWasmManager = {
      getWalletCore: vi.fn().mockResolvedValue({}),
    } as any

    mockServerManager = {
      createFastVault: vi.fn().mockResolvedValue({
        vault: {
          name: 'Fast Vault',
          publicKeys: {
            ecdsa: '02test_ecdsa_key',
            eddsa: 'test_eddsa_key',
          },
          hexChainCode: 'test_chain_code',
          localPartyId: 'local-1',
          signers: ['local-1', 'Server-1'],
          keyShares: { ecdsa: 'mock_ecdsa', eddsa: 'mock_eddsa' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 0,
        } as Vault,
        sessionId: 'test-session-id',
      }),
    } as any

    vaultManager = new VaultManager(mockWasmManager, mockServerManager, {
      defaultChains: [Chain.Bitcoin, Chain.Ethereum, Chain.Solana],
      defaultCurrency: 'USD',
    })
  })

  // ===== VAULT CREATION =====

  describe('createVault', () => {
    it('should create a fast vault by default', async () => {
      const vault = await vaultManager.createVault('Test Fast Vault', {
        type: 'fast',
        email: 'test@example.com',
        password: 'SecurePassword123!',
      })

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Fast Vault')
      expect(mockServerManager.createFastVault).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Fast Vault',
          email: 'test@example.com',
          password: 'SecurePassword123!',
        })
      )
    })

    it('should set newly created vault as active', async () => {
      await vaultManager.createVault('Fast Vault', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass123',
      })

      const activeVault = vaultManager.getActiveVault()
      expect(activeVault).toBeDefined()
      expect(activeVault?.data.name).toBe('Fast Vault')
      expect(activeVault).not.toBeNull()
    })

    it('should require email for fast vault creation', async () => {
      await expect(
        vaultManager.createVault('No Email Vault', {
          type: 'fast',
          password: 'pass123',
        })
      ).rejects.toThrow('Email is required for fast vault creation')
    })

    it('should require password for fast vault creation', async () => {
      await expect(
        vaultManager.createVault('No Password Vault', {
          type: 'fast',
          email: 'test@example.com',
        })
      ).rejects.toThrow('Password is required for fast vault creation')
    })

    it('should throw error for secure vault creation (not implemented)', async () => {
      await expect(
        vaultManager.createVault('Secure Vault', {
          type: 'secure',
        })
      ).rejects.toThrow('Secure vault creation not implemented yet')
    })

    it('should call onProgress callback during creation', async () => {
      const onProgress = vi.fn()

      await vaultManager.createVault('Progress Vault', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass123',
        onProgress,
      })

      // Verify onProgress was passed to ServerManager
      expect(mockServerManager.createFastVault).toHaveBeenCalledWith(
        expect.objectContaining({
          onProgress: expect.any(Function),
        })
      )
    })
  })

  // ===== VAULT IMPORT =====

  describe('addVault (import)', () => {
    it('should import unencrypted vault file', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Imported Vault',
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Imported Vault')
    })

    it('should import encrypted vault file with correct password', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Encrypted Vault',
      })
      const password = 'MySecretPassword123'
      const file = createMockVaultFile(vaultProtobuf, true, password)

      const vault = await vaultManager.addVault(file, password)

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Encrypted Vault')
    })

    it('should reject encrypted vault without password', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Encrypted Vault',
      })
      const file = createMockVaultFile(vaultProtobuf, true, 'password123')

      await expect(vaultManager.addVault(file)).rejects.toThrow(
        VaultImportError
      )
      await expect(vaultManager.addVault(file)).rejects.toThrow(
        'Password is required to decrypt this vault'
      )
    })

    it('should reject encrypted vault with wrong password', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Encrypted Vault',
      })
      const file = createMockVaultFile(vaultProtobuf, true, 'correct_password')

      await expect(
        vaultManager.addVault(file, 'wrong_password')
      ).rejects.toThrow(VaultImportError)
    })

    it('should reject non-.vult files', async () => {
      const file = new File([new Blob(['data'])], 'not-a-vault.txt')
      ;(file as any).buffer = new ArrayBuffer(0)

      await expect(vaultManager.addVault(file)).rejects.toThrow(
        VaultImportError
      )
      await expect(vaultManager.addVault(file)).rejects.toThrow(
        'Only .vult files are supported for vault import'
      )
    })

    it('should set imported vault as active', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Active Import',
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      await vaultManager.addVault(file)

      const activeVault = vaultManager.getActiveVault()
      expect(activeVault).toBeDefined()
      expect(activeVault?.data.name).toBe('Active Import')
    })

    it('should determine vault type from signers (fast vault)', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Fast Vault',
        signers: ['device-1', 'Server-1'], // Has Server- prefix
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)
      const summary = vault.summary()

      expect(summary.type).toBe('fast')
    })

    it('should determine vault type from signers (secure vault)', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Secure Vault',
        signers: ['device-1', 'device-2', 'device-3'], // No Server- prefix
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)
      const summary = vault.summary()

      expect(summary.type).toBe('secure')
    })

    it('should handle corrupted vault file', async () => {
      const file = new File([new Blob(['corrupted data!!!'])], 'corrupted.vult')
      ;(file as any).buffer = new TextEncoder().encode(
        'corrupted data!!!'
      ).buffer

      await expect(vaultManager.addVault(file)).rejects.toThrow(
        VaultImportError
      )
    })

    it('should throw VaultImportError with correct error code', async () => {
      const file = new File([new Blob(['bad'])], 'bad.vult')
      ;(file as any).buffer = new TextEncoder().encode('bad').buffer

      try {
        await vaultManager.addVault(file)
        expect.fail('Should have thrown VaultImportError')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultImportError)
        expect((error as VaultImportError).code).toBe(
          VaultImportErrorCode.CORRUPTED_DATA
        )
      }
    })
  })

  // ===== VAULT LISTING =====

  describe('listVaults', () => {
    it('should return empty array when no vaults exist', async () => {
      const vaults = await vaultManager.listVaults()
      expect(vaults).toEqual([])
    })

    it('should list all created vaults', async () => {
      // Create two vaults
      await vaultManager.createVault('Vault 1', {
        type: 'fast',
        email: 'test1@example.com',
        password: 'pass1',
      })

      // Modify mock to return different vault for second call
      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02different_ecdsa_key',
            eddsa: 'different_eddsa_key',
          },
          hexChainCode: 'different_chain_code',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa2', eddsa: 'mock_eddsa2' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'test-session-id-2',
      })

      await vaultManager.createVault('Vault 2', {
        type: 'fast',
        email: 'test2@example.com',
        password: 'pass2',
      })

      const vaults = await vaultManager.listVaults()

      expect(vaults).toHaveLength(2)
      expect(vaults[0].name).toBe('Fast Vault')
      expect(vaults[1].name).toBe('Vault 2')
    })

    it('should include vault metadata in summary', async () => {
      await vaultManager.createVault('Metadata Vault', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      const vaults = await vaultManager.listVaults()
      const summary = vaults[0]

      expect(summary).toHaveProperty('id')
      expect(summary).toHaveProperty('name')
      expect(summary).toHaveProperty('type')
      expect(summary).toHaveProperty('chains')
      expect(summary).toHaveProperty('createdAt')
      expect(summary).toHaveProperty('isBackedUp')
      expect(summary).toHaveProperty('isEncrypted')
      expect(summary).toHaveProperty('threshold')
      expect(summary).toHaveProperty('totalSigners')
      expect(summary).toHaveProperty('signers')
      expect(summary).toHaveProperty('keys')
    })

    it('should list imported vaults', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Imported Vault',
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      await vaultManager.addVault(file)

      const vaults = await vaultManager.listVaults()

      expect(vaults).toHaveLength(1)
      expect(vaults[0].name).toBe('Imported Vault')
    })

    it('should include correct threshold for 2-of-2 vaults', async () => {
      await vaultManager.createVault('2-of-2 Vault', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      const vaults = await vaultManager.listVaults()

      expect(vaults[0].threshold).toBe(2)
      expect(vaults[0].totalSigners).toBe(2)
    })

    it('should mark imported vaults as backed up', async () => {
      const vaultProtobuf = createMockVaultProtobuf()
      const file = createMockVaultFile(vaultProtobuf, false)

      await vaultManager.addVault(file)

      const vaults = await vaultManager.listVaults()

      expect(vaults[0].isBackedUp()).toBe(true)
    })
  })

  // ===== VAULT DELETION =====

  describe('deleteVault', () => {
    it('should delete a vault', async () => {
      const vault = await vaultManager.createVault('To Delete', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.deleteVault(vault)

      const vaults = await vaultManager.listVaults()
      expect(vaults).toHaveLength(0)
    })

    it('should clear active vault if deleted vault was active', async () => {
      const vault = await vaultManager.createVault('Active To Delete', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      expect(vaultManager.getActiveVault()).toBeDefined()

      await vaultManager.deleteVault(vault)

      expect(vaultManager.getActiveVault()).toBeNull()
    })

    it('should not affect active vault if different vault is deleted', async () => {
      const vault1 = await vaultManager.createVault('Vault 1', {
        type: 'fast',
        email: 'test1@example.com',
        password: 'pass1',
      })

      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02different_key',
            eddsa: 'different_key',
          },
          hexChainCode: 'different',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa3', eddsa: 'mock_eddsa3' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'session-2',
      })

      await vaultManager.createVault('Vault 2', {
        type: 'fast',
        email: 'test2@example.com',
        password: 'pass2',
      })

      // Vault 2 is active after creation
      await vaultManager.deleteVault(vault1)

      const activeVault = vaultManager.getActiveVault()
      expect(activeVault).toBeDefined()
      expect(activeVault?.data.name).toBe('Vault 2')
    })
  })

  describe('clearVaults', () => {
    it('should remove all vaults', async () => {
      await vaultManager.createVault('Vault 1', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.clearVaults()

      const vaults = await vaultManager.listVaults()
      expect(vaults).toHaveLength(0)
    })

    it('should clear active vault', async () => {
      await vaultManager.createVault('Active', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      await vaultManager.clearVaults()

      expect(vaultManager.getActiveVault()).toBeNull()
    })
  })

  // ===== ACTIVE VAULT MANAGEMENT =====

  describe('active vault management', () => {
    it('should have no active vault initially', () => {
      expect(vaultManager.hasActiveVault()).toBe(false)
      expect(vaultManager.getActiveVault()).toBeNull()
    })

    it('should set active vault', async () => {
      const vault = await vaultManager.createVault('Active', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      vaultManager.setActiveVault(vault)

      expect(vaultManager.hasActiveVault()).toBe(true)
      expect(vaultManager.getActiveVault()).toBe(vault)
    })

    it('should switch between vaults', async () => {
      const vault1 = await vaultManager.createVault('Vault 1', {
        type: 'fast',
        email: 'test1@example.com',
        password: 'pass1',
      })

      mockServerManager.createFastVault = vi.fn().mockResolvedValue({
        vault: {
          name: 'Vault 2',
          publicKeys: {
            ecdsa: '02vault2_key',
            eddsa: 'vault2_key',
          },
          hexChainCode: 'vault2',
          localPartyId: 'local-2',
          signers: ['local-2', 'Server-2'],
          keyShares: { ecdsa: 'mock_ecdsa4', eddsa: 'mock_eddsa4' },
          resharePrefix: '',
          libType: 'GG20',
          createdAt: Date.now(),
          isBackedUp: false,
          order: 1,
        } as Vault,
        sessionId: 'session-2',
      })

      const vault2 = await vaultManager.createVault('Vault 2', {
        type: 'fast',
        email: 'test2@example.com',
        password: 'pass2',
      })

      vaultManager.setActiveVault(vault1)
      expect(vaultManager.getActiveVault()?.data.name).toBe('Fast Vault')

      vaultManager.setActiveVault(vault2)
      expect(vaultManager.getActiveVault()?.data.name).toBe('Vault 2')
    })
  })

  // ===== FILE OPERATIONS =====

  describe('isVaultFileEncrypted', () => {
    it('should detect unencrypted vault file', async () => {
      const vaultProtobuf = createMockVaultProtobuf()
      const file = createMockVaultFile(vaultProtobuf, false)

      const isEncrypted = await vaultManager.isVaultFileEncrypted(file)

      expect(isEncrypted).toBe(false)
    })

    it('should detect encrypted vault file', async () => {
      const vaultProtobuf = createMockVaultProtobuf()
      const file = createMockVaultFile(vaultProtobuf, true, 'password123')

      const isEncrypted = await vaultManager.isVaultFileEncrypted(file)

      expect(isEncrypted).toBe(true)
    })

    it('should throw error for corrupted file', async () => {
      const file = new File([new Blob(['corrupted'])], 'bad.vult')
      ;(file as any).buffer = new TextEncoder().encode('corrupted').buffer

      await expect(vaultManager.isVaultFileEncrypted(file)).rejects.toThrow(
        VaultImportError
      )
    })
  })

  // ===== EDGE CASES =====

  describe('edge cases', () => {
    it('should handle vault with minimal data', async () => {
      // NOTE: keyShares cannot be empty - fromCommVault requires ECDSA and EdDSA keyShares
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Minimal',
        // Use default keyShares (will have ECDSA and EdDSA)
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)

      expect(vault).toBeDefined()
      expect(vault.data.name).toBe('Minimal')
    })

    it('should handle vault with special characters in name', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: 'Test Vault 🔐 (2024)',
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)

      expect(vault.data.name).toBe('Test Vault 🔐 (2024)')
    })

    it('should handle multiple signers for secure vault', async () => {
      const vaultProtobuf = createMockVaultProtobuf({
        name: '3-of-5 Vault',
        signers: ['device-1', 'device-2', 'device-3', 'device-4', 'device-5'],
      })
      const file = createMockVaultFile(vaultProtobuf, false)

      const vault = await vaultManager.addVault(file)
      const summary = vault.summary()

      // Verify vault data has correct signers
      expect(vault.data.signers).toHaveLength(5)
      expect(summary.type).toBe('secure') // No Server- prefix
    })

    it('should create VaultClass instance with proper dependencies', async () => {
      const vault = await vaultManager.createVault('Test', {
        type: 'fast',
        email: 'test@example.com',
        password: 'pass',
      })

      // Verify vault has access to services
      expect(vault).toBeDefined()
      expect(vault.data).toBeDefined()
      expect(vault.summary).toBeDefined()
    })
  })
})
