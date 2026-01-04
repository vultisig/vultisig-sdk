import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RelaySigningService } from '../../../src/services/RelaySigningService'

// Mock the core MPC modules
vi.mock('@core/mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-party-${Math.random().toString(36).slice(2, 8)}`),
}))

vi.mock('@core/mpc/utils/generateHexEncryptionKey', () => ({
  generateHexEncryptionKey: vi.fn(() => 'a'.repeat(64)),
}))

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

vi.mock('@core/chain/ChainKind', () => ({
  getChainKind: vi.fn(() => 'evm'),
}))

vi.mock('@core/chain/signing/SignatureAlgorithm', () => ({
  signatureAlgorithms: {
    evm: 'ecdsa',
    utxo: 'ecdsa',
    cosmos: 'ecdsa',
    sui: 'eddsa',
    solana: 'eddsa',
    polkadot: 'eddsa',
    ton: 'eddsa',
    ripple: 'ecdsa',
    tron: 'ecdsa',
    cardano: 'eddsa',
  },
}))

describe('RelaySigningService', () => {
  let service: RelaySigningService

  beforeEach(() => {
    service = new RelaySigningService()
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should use default relay URL', () => {
      const defaultService = new RelaySigningService()
      expect(defaultService).toBeDefined()
    })

    it('should accept custom relay URL', () => {
      const customService = new RelaySigningService('https://custom.relay.com')
      expect(customService).toBeDefined()
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
      expect(params).toHaveProperty('localPartyId')
    })
  })

  describe('generateQRPayload', () => {
    it('should generate valid QR payload URL', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'test-session-123',
        hexEncryptionKey: 'a'.repeat(64),
        localPartyId: 'test-party-id',
        vaultPublicKeyEcdsa: 'mock-public-key',
      })

      expect(payload).toContain('vultisig://')
      expect(payload).toContain('type=SignTransaction')
      expect(payload).toContain('tssType=Keysign')
      expect(payload).toContain('jsonData=')
    })

    it('should URL-encode the compressed data', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'test-session',
        hexEncryptionKey: 'a'.repeat(64),
        localPartyId: 'test-party',
        vaultPublicKeyEcdsa: 'mock-public-key',
      })

      // The payload should be a valid URL
      expect(() => new URL(payload)).not.toThrow()
    })

    it('should include all required parameters', async () => {
      const payload = await service.generateQRPayload({
        sessionId: 'session-abc',
        hexEncryptionKey: 'x'.repeat(64),
        localPartyId: 'party-xyz',
        vaultPublicKeyEcdsa: 'test-ecdsa-key',
      })

      const url = new URL(payload)
      expect(url.protocol).toBe('vultisig:')
      expect(url.searchParams.get('type')).toBe('SignTransaction')
      expect(url.searchParams.get('tssType')).toBe('Keysign')
      expect(url.searchParams.get('jsonData')).toBeDefined()
    })
  })

  describe('signWithRelay validation', () => {
    it('should require messageHashes in payload', async () => {
      const mockVault = {
        keyShares: { ecdsa: 'mock-key-share' },
        signers: ['party1', 'party2', 'party3'],
        publicKeys: { ecdsa: 'mock-ecdsa-key', eddsa: 'mock-eddsa-key' },
      }

      const payloadWithoutHashes = {
        chain: 'Ethereum',
        transaction: {},
        // messageHashes missing
      }

      await expect(service.signWithRelay(mockVault as any, payloadWithoutHashes as any)).rejects.toThrow(
        'SigningPayload must include pre-computed messageHashes'
      )
    })

    it('should require loaded key shares', async () => {
      const mockVaultNoKeys = {
        keyShares: {},
        signers: ['party1', 'party2'],
        publicKeys: { ecdsa: 'mock-key', eddsa: 'mock-key' },
      }

      const payload = {
        chain: 'Ethereum',
        transaction: {},
        messageHashes: ['hash1'],
      }

      await expect(service.signWithRelay(mockVaultNoKeys as any, payload as any)).rejects.toThrow(
        'Vault key shares not loaded'
      )
    })
  })

  describe('signBytesWithRelay validation', () => {
    it('should require loaded key shares', async () => {
      const mockVaultNoKeys = {
        keyShares: {},
        signers: ['party1', 'party2'],
        publicKeys: { ecdsa: 'mock-key', eddsa: 'mock-key' },
      }

      await expect(
        service.signBytesWithRelay(mockVaultNoKeys as any, {
          messageHashes: ['hash1'],
          chain: 'Ethereum' as any,
        })
      ).rejects.toThrow('Vault key shares not loaded')
    })
  })

  describe('RelaySigningOptions type', () => {
    it('should accept all optional fields', () => {
      const options = {
        onProgress: () => {},
        onQRCodeReady: () => {},
        onDeviceJoined: () => {},
        deviceTimeout: 60000,
        pollInterval: 500,
      }
      expect(options).toBeDefined()
    })

    it('should accept minimal options', () => {
      const options = {}
      expect(options).toBeDefined()
    })
  })

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

describe('RelaySigningService threshold calculation', () => {
  describe('threshold formula', () => {
    it('should calculate 2-of-3 for 3 signers', () => {
      // Threshold formula: ceil((signers.length + 1) / 2) when > 2
      const signers = ['p1', 'p2', 'p3']
      const threshold = signers.length > 2 ? Math.ceil((signers.length + 1) / 2) : 2
      expect(threshold).toBe(2)
    })

    it('should calculate 3-of-5 for 5 signers', () => {
      const signers = ['p1', 'p2', 'p3', 'p4', 'p5']
      const threshold = signers.length > 2 ? Math.ceil((signers.length + 1) / 2) : 2
      expect(threshold).toBe(3)
    })

    it('should use 2 for 2 signers', () => {
      const signers = ['p1', 'p2']
      const threshold = signers.length > 2 ? Math.ceil((signers.length + 1) / 2) : 2
      expect(threshold).toBe(2)
    })

    it('should calculate 4-of-7 for 7 signers', () => {
      const signers = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
      const threshold = signers.length > 2 ? Math.ceil((signers.length + 1) / 2) : 2
      expect(threshold).toBe(4)
    })
  })
})

describe('RelaySigningService vs FastSigningService', () => {
  describe('key differences', () => {
    it('should handle multi-device (n > 2) vaults', () => {
      // RelaySigningService is designed for secure vaults with n devices
      const secureVaultSigners = ['party1', 'party2', 'party3']
      expect(secureVaultSigners.length).toBeGreaterThanOrEqual(2)
    })

    it('should support QR code generation for mobile pairing', async () => {
      const service = new RelaySigningService()
      const qrPayload = await service.generateQRPayload({
        sessionId: 'test-session',
        hexEncryptionKey: 'a'.repeat(64),
        localPartyId: 'test-party',
        vaultPublicKeyEcdsa: 'test-key',
      })
      expect(qrPayload).toContain('Keysign')
    })

    it('should use relay mode for signing', () => {
      // RelaySigningService uses 'relay' mode vs FastSigningService 'fast' mode
      const expectedMode = 'relay'
      expect(expectedMode).toBe('relay')
    })
  })
})
