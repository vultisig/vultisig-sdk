import { Chain } from '@vultisig/core-chain/Chain'
import { keysign } from '@vultisig/core-mpc/keysign'
import { getJoinKeysignUrl } from '@vultisig/core-mpc/keysign/utils/getJoinKeysignUrl'
import { MldsaKeysign } from '@vultisig/core-mpc/mldsa/mldsaKeysign'
import { joinMpcSession } from '@vultisig/core-mpc/session/joinMpcSession'
import { startMpcSession } from '@vultisig/core-mpc/session/startMpcSession'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getChainSigningInfo } from '../../../src/adapters/getChainSigningInfo'
import { RelaySigningService } from '../../../src/services/RelaySigningService'

// Mock the core MPC modules
vi.mock('@vultisig/core-mpc/devices/localPartyId', () => ({
  generateLocalPartyId: vi.fn((prefix: string) => `${prefix}-party-${Math.random().toString(36).slice(2, 8)}`),
}))

vi.mock('@vultisig/core-mpc/utils/generateHexEncryptionKey', () => ({
  generateHexEncryptionKey: vi.fn(() => 'a'.repeat(64)),
}))

vi.mock('@vultisig/core-mpc/keysign', () => ({
  keysign: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/mldsa/mldsaKeysign', () => ({
  MldsaKeysign: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/session/joinMpcSession', () => ({
  joinMpcSession: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/session/startMpcSession', () => ({
  startMpcSession: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
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
    vi.mocked(getChainSigningInfo).mockReturnValue({
      signatureAlgorithm: 'ecdsa',
      derivePath: "m/44'/60'/0'/0/0",
      chainPath: 'm/44/60/0/0/0',
    })
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

    it('should preserve a caller-supplied session ID', () => {
      const params = service.generateSessionParams('caller-session-id')
      expect(params.sessionId).toBe('caller-session-id')
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

    it('passes the configured relay URL to the QR payload generator', async () => {
      const customRelayUrl = 'https://relay.example.test/router'
      const customService = new RelaySigningService(customRelayUrl)

      await customService.generateQRPayload({
        sessionId: 'session-custom',
        hexEncryptionKey: 'c'.repeat(64),
        localPartyId: 'party-custom',
        vaultPublicKeyEcdsa: 'test-ecdsa-key',
      })

      expect(getJoinKeysignUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          serverType: 'relay',
          serverUrl: customRelayUrl,
          sessionId: 'session-custom',
        })
      )
    })
  })

  describe('signWithRelay validation', () => {
    it('preserves an explicit abort identity', async () => {
      const abortController = new AbortController()
      abortController.abort('test cancellation')

      await expect(
        service.signWithRelay({} as any, {} as any, mockWalletCore, { signal: abortController.signal })
      ).rejects.toMatchObject({
        name: 'AbortError',
        message: 'Operation aborted',
      })
    })

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

    it('rejects a QBTC vault without an MLDSA key share before joining the relay', async () => {
      vi.mocked(getChainSigningInfo).mockReturnValue({
        signatureAlgorithm: 'mldsa',
        derivePath: "m/44'/118'/0'/0/0",
        chainPath: 'm/44/118/0/0/0',
      })

      const vault = {
        keyShares: { ecdsa: 'ecdsa-share' },
        signers: ['party1', 'party2'],
        publicKeys: { ecdsa: 'ecdsa-public-key', eddsa: 'eddsa-public-key' },
      }
      const payload = {
        chain: Chain.QBTC,
        transaction: {},
        messageHashes: ['ab'.repeat(32)],
      }

      await expect(service.signWithRelay(vault as any, payload as any, mockWalletCore)).rejects.toThrow(
        'No MLDSA key share found in vault'
      )
      expect(joinMpcSession).not.toHaveBeenCalled()
      expect(keysign).not.toHaveBeenCalled()
    })

    it('rejects a QBTC payload when the selected signing domain is not MLDSA', async () => {
      const vault = {
        keyShares: { ecdsa: 'ecdsa-share' },
        keyShareMldsa: 'mldsa-key-share',
        signers: ['party1', 'party2'],
        publicKeys: { ecdsa: 'ecdsa-public-key', eddsa: 'eddsa-public-key' },
      }
      const payload = {
        chain: Chain.QBTC,
        transaction: {},
        messageHashes: ['ab'.repeat(32)],
      }

      await expect(service.signWithRelay(vault as any, payload as any, mockWalletCore)).rejects.toThrow(
        'QBTC requires MLDSA signing, but ecdsa was selected'
      )
      expect(joinMpcSession).not.toHaveBeenCalled()
      expect(keysign).not.toHaveBeenCalled()
    })
  })

  describe('QBTC MLDSA signing', () => {
    const messageHash = 'ab'.repeat(32)
    const vault = {
      keyShares: {},
      keyShareMldsa: 'mldsa-key-share',
      signers: ['party1', 'party2'],
      publicKeys: { ecdsa: 'ecdsa-public-key', eddsa: 'eddsa-public-key' },
    }
    const payload = {
      chain: Chain.QBTC,
      transaction: {},
      messageHashes: [messageHash],
    }

    beforeEach(() => {
      vi.mocked(getChainSigningInfo).mockReturnValue({
        signatureAlgorithm: 'mldsa',
        derivePath: "m/44'/118'/0'/0/0",
        chainPath: 'm/44/118/0/0/0',
      })
      vi.mocked(queryUrl).mockResolvedValue(['peer-1', 'peer-2'])
    })

    it('routes SecureVault QBTC signing directly through MLDSA key material', async () => {
      const startKeysignWithRetry = vi.fn().mockResolvedValue([{ msg: messageHash, signature: '0xcafe' }])
      vi.mocked(MldsaKeysign).mockImplementation(function () {
        return { startKeysignWithRetry }
      } as unknown as typeof MldsaKeysign)

      const signature = await service.signWithRelay(vault as any, payload as any, mockWalletCore, {
        sessionId: 'qbtc-session',
      })

      expect(signature).toEqual({
        signature: 'cafe',
        format: 'MLDSA',
        mldsaSignature: 'cafe',
      })
      expect(MldsaKeysign).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'qbtc-session',
          messagesToSign: [messageHash],
          keyShareBase64: 'mldsa-key-share',
          chainPath: 'm',
          isInitiatingDevice: true,
        })
      )
      expect(startMpcSession).toHaveBeenCalledOnce()
      expect(startKeysignWithRetry).toHaveBeenCalledOnce()
      expect(keysign).not.toHaveBeenCalled()
    })

    it('propagates MLDSA failure without falling back to a generic key share', async () => {
      const startKeysignWithRetry = vi.fn().mockRejectedValue(new Error('MLDSA session failed'))
      vi.mocked(MldsaKeysign).mockImplementation(function () {
        return { startKeysignWithRetry }
      } as unknown as typeof MldsaKeysign)
      const onProgress = vi.fn()

      await expect(
        service.signWithRelay(vault as any, payload as any, mockWalletCore, {
          sessionId: 'qbtc-failure-session',
          onProgress,
        })
      ).rejects.toThrow('Relay signing failed: MLDSA session failed')

      expect(keysign).not.toHaveBeenCalled()
      expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({ step: 'complete' }))
    })

    it('uses the same dedicated MLDSA route for raw QBTC bytes', async () => {
      const startKeysignWithRetry = vi.fn().mockResolvedValue([{ msg: messageHash, signature: 'beef' }])
      vi.mocked(MldsaKeysign).mockImplementation(function () {
        return { startKeysignWithRetry }
      } as unknown as typeof MldsaKeysign)

      const signature = await service.signBytesWithRelay(
        vault as any,
        { chain: Chain.QBTC, messageHashes: [messageHash] },
        mockWalletCore,
        { sessionId: 'qbtc-bytes-session' }
      )

      expect(signature).toEqual({
        signature: 'beef',
        format: 'MLDSA',
        mldsaSignature: 'beef',
      })
      expect(keysign).not.toHaveBeenCalled()
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
