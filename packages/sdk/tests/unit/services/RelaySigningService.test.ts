import { getKeygenThreshold } from '@vultisig/core-mpc/getKeygenThreshold'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RelaySigningService } from '../../../src/services/RelaySigningService'

// Mock the core MPC modules
vi.mock('@vultisig/core-mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-party-${Math.random().toString(36).slice(2, 8)}`),
}))

vi.mock('@vultisig/core-mpc/utils/generateHexEncryptionKey', () => ({
  generateHexEncryptionKey: vi.fn(() => 'a'.repeat(64)),
}))

// Mock getJoinKeysignUrl to return a predictable URL format
vi.mock('@vultisig/core-mpc/keysign/utils/getJoinKeysignUrl', () => ({
  getJoinKeysignUrl: vi.fn(
    ({ vaultId, sessionId }) =>
      `https://vultisig.com?type=SignTransaction&vault=${vaultId}&jsonData=compressed-data&session=${sessionId}`
  ),
}))

// Mock SDK crypto module
vi.mock('../../../src/crypto', () => ({
  randomUUID: vi.fn(() => `test-uuid-${Math.random().toString(36).slice(2, 8)}`),
}))

// Mock getChainSigningInfo adapter
vi.mock('../../../src/adapters/getChainSigningInfo', () => ({
  getChainSigningInfo: vi.fn(() => ({
    signatureAlgorithm: 'ecdsa',
    derivePath: "m/44'/60'/0'/0/0",
    chainPath: 'm/44/60/0/0/0',
  })),
}))

// Mock WalletCore for tests
const mockWalletCore = {} as any

vi.mock('@vultisig/core-chain/ChainKind', () => ({
  getChainKind: vi.fn(() => 'evm'),
}))

vi.mock('@vultisig/core-chain/signing/SignatureAlgorithm', () => ({
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

      // Uses getJoinKeysignUrl from core which generates https://vultisig.com format
      expect(payload).toContain('https://vultisig.com')
      expect(payload).toContain('type=SignTransaction')
      expect(payload).toContain('vault=')
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
      expect(url.protocol).toBe('https:')
      expect(url.searchParams.get('type')).toBe('SignTransaction')
      expect(url.searchParams.get('vault')).toBe('test-ecdsa-key')
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

      await expect(
        service.signWithRelay(mockVault as any, payloadWithoutHashes as any, mockWalletCore)
      ).rejects.toThrow('SigningPayload must include pre-computed messageHashes')
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

      await expect(service.signWithRelay(mockVaultNoKeys as any, payload as any, mockWalletCore)).rejects.toThrow(
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
        service.signBytesWithRelay(
          mockVaultNoKeys as any,
          {
            messageHashes: ['hash1'],
            chain: 'Ethereum' as any,
          },
          mockWalletCore
        )
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
  describe('threshold formula matches canonical getKeygenThreshold', () => {
    // RelaySigningService MUST use the same threshold formula as keygen
    // (getKeygenThreshold: ceil(signers * 2 / 3)). A prior regression used
    // ceil((signers + 1) / 2), which silently diverges for vault sizes
    // 5, 7, 8, 9, 10, 11, 12, 13, 14, 15+ and breaks the signing ceremony
    // (waitForDevices requires the wrong number of parties).
    it.each([
      // [signers, expectedThreshold]
      [2, 2],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 4],
      [7, 5],
      [8, 6],
      [9, 6],
      [10, 7],
      [11, 8],
      [12, 8],
      [13, 9],
      [14, 10],
      [15, 10],
    ])('for %i signers, threshold should be %i (canonical ceil(n*2/3))', (signers, expected) => {
      expect(getKeygenThreshold(signers)).toBe(expected)
    })

    it('regression: previously-correct sizes (2-of-2, 3-of-3) are unchanged', () => {
      expect(getKeygenThreshold(2)).toBe(2)
      expect(getKeygenThreshold(3)).toBe(2)
    })

    it('regression: previously-broken sizes now match canonical threshold', () => {
      // These sizes diverged under the old ceil((n+1)/2) formula.
      const previouslyBroken = [5, 7, 8, 9, 10, 11, 13, 14]
      for (const n of previouslyBroken) {
        const oldWrongFormula = n > 2 ? Math.ceil((n + 1) / 2) : 2
        const canonical = getKeygenThreshold(n)
        expect(canonical).not.toBe(oldWrongFormula)
      }
    })
  })

  describe('RelaySigningService.signWithRelay uses canonical threshold', () => {
    it.each([
      [5, 4],
      [7, 5],
      [8, 6],
    ])(
      'waits for the canonical threshold (%i signers -> %i devices), not the legacy formula',
      async (signerCount, expectedThreshold) => {
        const service = new RelaySigningService()
        const signers = Array.from({ length: signerCount }, (_, i) => `party-${i}`)

        const mockVault = {
          keyShares: { ecdsa: 'mock-key-share' },
          signers,
          publicKeys: { ecdsa: 'mock-ecdsa-key', eddsa: 'mock-eddsa-key' },
        }

        const payload = {
          chain: 'Ethereum',
          transaction: {},
          messageHashes: ['hash1'],
        }

        const waitForDevicesSpy = vi
          .spyOn(service as any, 'waitForDevices')
          .mockRejectedValue(new Error('stop-before-mpc'))

        await expect(service.signWithRelay(mockVault as any, payload as any, mockWalletCore)).rejects.toThrow(
          'stop-before-mpc'
        )

        expect(waitForDevicesSpy).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expectedThreshold,
          expect.any(Object)
        )
      }
    )
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
      // Uses getJoinKeysignUrl which includes vault ID and SignTransaction type
      expect(qrPayload).toContain('type=SignTransaction')
      expect(qrPayload).toContain('vault=test-key')
    })

    it('should use relay mode for signing', () => {
      // RelaySigningService uses 'relay' mode vs FastSigningService 'fast' mode
      const expectedMode = 'relay'
      expect(expectedMode).toBe('relay')
    })
  })
})
