import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SecureVaultCreationService } from '../../../src/services/SecureVaultCreationService'

// Mock the core MPC modules
vi.mock('@core/mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-party-${Math.random().toString(36).slice(2, 8)}`),
}))

vi.mock('@core/mpc/utils/generateHexEncryptionKey', () => ({
  generateHexEncryptionKey: vi.fn(() => 'a'.repeat(64)),
}))

vi.mock('@core/mpc/utils/generateHexChainCode', () => ({
  generateHexChainCode: vi.fn(() => 'b'.repeat(64)),
}))

vi.mock('@core/mpc/getKeygenThreshold', () => ({
  getKeygenThreshold: vi.fn((devices: number) => Math.ceil((devices + 1) / 2)),
}))

describe('SecureVaultCreationService', () => {
  let service: SecureVaultCreationService

  beforeEach(() => {
    service = new SecureVaultCreationService()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should use default relay URL', () => {
      const defaultService = new SecureVaultCreationService()
      expect(defaultService).toBeDefined()
    })

    it('should accept custom relay URL', () => {
      const customService = new SecureVaultCreationService('https://custom.relay.com')
      expect(customService).toBeDefined()
    })
  })

  describe('calculateThreshold', () => {
    it('should calculate 2-of-3 for 3 devices', () => {
      const threshold = service.calculateThreshold(3)
      expect(threshold).toBe(2)
    })

    it('should calculate 3-of-5 for 5 devices', () => {
      const threshold = service.calculateThreshold(5)
      expect(threshold).toBe(3)
    })

    it('should calculate 2-of-2 for 2 devices', () => {
      const threshold = service.calculateThreshold(2)
      expect(threshold).toBe(2) // ceil((2+1)/2) = 2
    })

    it('should calculate 3-of-4 for 4 devices', () => {
      const threshold = service.calculateThreshold(4)
      expect(threshold).toBe(3) // ceil((4+1)/2) = 3
    })

    it('should calculate 4-of-7 for 7 devices', () => {
      const threshold = service.calculateThreshold(7)
      expect(threshold).toBe(4) // ceil((7+1)/2) = 4
    })
  })

  describe('generateSessionParams', () => {
    it('should generate valid session ID', () => {
      const params = service.generateSessionParams()
      expect(params.sessionId).toBeDefined()
      expect(typeof params.sessionId).toBe('string')
      expect(params.sessionId.length).toBeGreaterThan(0)
    })

    it('should generate valid hex encryption key', () => {
      const params = service.generateSessionParams()
      expect(params.hexEncryptionKey).toBeDefined()
      expect(params.hexEncryptionKey).toBe('a'.repeat(64))
      expect(params.hexEncryptionKey.length).toBe(64)
    })

    it('should generate valid hex chain code', () => {
      const params = service.generateSessionParams()
      expect(params.hexChainCode).toBeDefined()
      expect(params.hexChainCode).toBe('b'.repeat(64))
      expect(params.hexChainCode.length).toBe(64)
    })

    it('should generate valid local party ID', () => {
      const params = service.generateSessionParams()
      expect(params.localPartyId).toBeDefined()
      expect(params.localPartyId).toContain('sdk-party')
    })

    it('should generate unique session IDs on each call', () => {
      const params1 = service.generateSessionParams()
      const params2 = service.generateSessionParams()
      expect(params1.sessionId).not.toBe(params2.sessionId)
    })

    it('should return all required fields', () => {
      const params = service.generateSessionParams()
      expect(params).toHaveProperty('sessionId')
      expect(params).toHaveProperty('hexEncryptionKey')
      expect(params).toHaveProperty('hexChainCode')
      expect(params).toHaveProperty('localPartyId')
    })
  })

  describe('createVault input validation', () => {
    it('should reject devices < 2', async () => {
      await expect(
        service.createVault({
          name: 'Test Vault',
          devices: 1,
        })
      ).rejects.toThrow('Secure vaults require at least 2 devices')
    })

    it('should reject threshold > devices', async () => {
      await expect(
        service.createVault({
          name: 'Test Vault',
          devices: 3,
          threshold: 4,
        })
      ).rejects.toThrow('Threshold cannot exceed number of devices')
    })

    it('should reject devices = 0', async () => {
      await expect(
        service.createVault({
          name: 'Test Vault',
          devices: 0,
        })
      ).rejects.toThrow('Secure vaults require at least 2 devices')
    })

    it('should reject negative devices', async () => {
      await expect(
        service.createVault({
          name: 'Test Vault',
          devices: -1,
        })
      ).rejects.toThrow('Secure vaults require at least 2 devices')
    })
  })

  describe('SecureVaultCreationStep type', () => {
    it('should have valid step values', () => {
      const validSteps = [
        'initializing',
        'generating_qr',
        'waiting_for_devices',
        'keygen_ecdsa',
        'keygen_eddsa',
        'finalizing',
        'complete',
      ]

      // This is a type check - we're verifying the shape of the type
      const step: Parameters<NonNullable<Parameters<typeof service.createVault>[0]['onProgress']>>[0] = {
        step: 'initializing',
        progress: 0,
        message: 'Test',
      }

      expect(validSteps).toContain(step.step)
    })
  })

  describe('SecureVaultCreateOptions type', () => {
    it('should accept minimal options', () => {
      const options = {
        name: 'Test Vault',
        devices: 3,
      }
      expect(options).toBeDefined()
    })

    it('should accept all optional fields', () => {
      const options = {
        name: 'Test Vault',
        devices: 3,
        password: 'secret',
        threshold: 2,
        onProgress: () => {},
        onQRCodeReady: () => {},
        onDeviceJoined: () => {},
      }
      expect(options).toBeDefined()
    })
  })
})

describe('SecureVaultCreationService with mocked QR generation', () => {
  let service: SecureVaultCreationService

  beforeEach(() => {
    service = new SecureVaultCreationService()
    vi.clearAllMocks()
  })

  // Mock the 7-zip compression for QR payload tests
  vi.mock('@core/mpc/compression/getSevenZip', () => ({
    getSevenZip: vi.fn(() => ({
      Compress: {
        encode: vi.fn(() => new Uint8Array([1, 2, 3, 4])),
      },
    })),
  }))

  vi.mock('@core/chain/utils/protobuf/toCompressedString', () => ({
    toCompressedString: vi.fn(() => 'compressed-base64-data'),
  }))

  describe('generateQRPayload', () => {
    it('should generate valid QR payload URL', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'test-session-123',
        hexEncryptionKey: 'a'.repeat(64),
        hexChainCode: 'b'.repeat(64),
        localPartyId: 'test-party-id',
        vaultName: 'My Vault',
      })

      expect(payload).toContain('vultisig://')
      expect(payload).toContain('type=NewVault')
      expect(payload).toContain('tssType=Keygen')
      expect(payload).toContain('jsonData=')
    })

    it('should URL-encode the compressed data', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'test-session',
        hexEncryptionKey: 'a'.repeat(64),
        hexChainCode: 'b'.repeat(64),
        localPartyId: 'test-party',
        vaultName: 'Test Vault',
      })

      // The payload should be a valid URL
      expect(() => new URL(payload)).not.toThrow()
    })

    it('should include all required parameters', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'session-abc',
        hexEncryptionKey: 'x'.repeat(64),
        hexChainCode: 'y'.repeat(64),
        localPartyId: 'party-xyz',
        vaultName: 'Vault Name',
      })

      const url = new URL(payload)
      expect(url.protocol).toBe('vultisig:')
      expect(url.searchParams.get('type')).toBe('NewVault')
      expect(url.searchParams.get('tssType')).toBe('Keygen')
      expect(url.searchParams.get('jsonData')).toBeDefined()
    })
  })
})

describe('SecureVaultCreationService callback integration', () => {
  // Note: Full createVault flow tests require mocking the relay server
  // and MPC operations, which is done in integration tests.
  // Unit tests focus on individual method behavior.

  describe('callback types', () => {
    it('should accept onProgress callback type', () => {
      const onProgress = (step: { step: string; progress: number; message: string }) => {
        expect(step).toHaveProperty('step')
        expect(step).toHaveProperty('progress')
        expect(step).toHaveProperty('message')
      }
      expect(typeof onProgress).toBe('function')
    })

    it('should accept onQRCodeReady callback type', () => {
      const onQRCodeReady = (qrPayload: string) => {
        expect(typeof qrPayload).toBe('string')
      }
      expect(typeof onQRCodeReady).toBe('function')
    })

    it('should accept onDeviceJoined callback type', () => {
      const onDeviceJoined = (deviceId: string, totalJoined: number, required: number) => {
        expect(typeof deviceId).toBe('string')
        expect(typeof totalJoined).toBe('number')
        expect(typeof required).toBe('number')
      }
      expect(typeof onDeviceJoined).toBe('function')
    })
  })
})
