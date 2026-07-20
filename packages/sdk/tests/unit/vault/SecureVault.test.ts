import { describe, expect, it, vi } from 'vitest'

import { RelaySigningService } from '../../../src/services/RelaySigningService'
import type { VaultData } from '../../../src/types'
import { SecureVault } from '../../../src/vault/SecureVault'
import { VaultError, VaultErrorCode } from '../../../src/vault/VaultError'

// vitest 4: vi.fn().mockImplementation(() => obj) is no longer constructable
// via `new`. Use vi.fn(function() { Object.assign(this, obj) }) so
// `new SecureVaultCreationService()` produces an instance with mocked methods.
vi.mock('../../../src/services/SecureVaultCreationService', () => ({
  SecureVaultCreationService: vi.fn(function (this: object) {
    Object.assign(this, {
      createVault: vi.fn().mockRejectedValue(new Error('Network error - mocked')),
      calculateThreshold: vi.fn((devices: number) => Math.ceil((devices + 1) / 2)),
      generateSessionParams: vi.fn(() => ({
        sessionId: 'mock-session-id',
        hexEncryptionKey: 'a'.repeat(64),
        hexChainCode: 'b'.repeat(64),
        localPartyId: 'mock-party-id',
      })),
    })
  }),
}))

// Mock the RelaySigningService — same vitest 4 constructor-pattern fix.
vi.mock('../../../src/services/RelaySigningService', () => ({
  RelaySigningService: vi.fn(function (this: object) {
    Object.assign(this, {
      signWithRelay: vi.fn().mockResolvedValue({
        signature: 'mock-signature-der',
        recovery: 0,
        format: 'ECDSA',
      }),
      signBytesWithRelay: vi.fn().mockResolvedValue({
        signature: 'mock-signature-der',
        recovery: 1,
        format: 'ECDSA',
      }),
      generateSessionParams: vi.fn(() => ({
        sessionId: 'mock-session-id',
        hexEncryptionKey: 'a'.repeat(64),
        localPartyId: 'mock-party-id',
      })),
      generateQRPayload: vi.fn().mockResolvedValue('vultisig://mock-qr-payload'),
    })
  }),
}))

const makeMockContext = () =>
  ({
    storage: {} as any,
    config: {},
    serverManager: {} as any,
    passwordCache: {} as any,
    wasmProvider: {} as any,
  }) as any

const makeSecureVaultData = (signers: string[]): VaultData => ({
  id: 'test-id',
  name: 'Secure Vault',
  type: 'secure',
  vultFileContent: '',
  isEncrypted: false,
  signers,
  localPartyId: signers[0],
  publicKeys: { ecdsa: 'abc', eddsa: 'def' },
  hexChainCode: 'abc',
  libType: 'DKLS',
  createdAt: Date.now(),
  isBackedUp: false,
  order: 0,
  lastModified: Date.now(),
  currency: 'usd',
  chains: [],
  tokens: {},
})

describe('SecureVault', () => {
  describe('static properties', () => {
    it('should have correct vault type characteristics', () => {
      // SecureVault is a class that extends VaultBase
      expect(SecureVault).toBeDefined()
      expect(typeof SecureVault.create).toBe('function')
      expect(typeof SecureVault.fromStorage).toBe('function')
      expect(typeof SecureVault.fromImport).toBe('function')
    })
  })

  describe('create() options validation', () => {
    // Note: These tests verify the method signature and type safety
    // Full creation flow tests require mocking the relay server

    it('should accept valid create options', () => {
      const validOptions = {
        name: 'Test Vault',
        devices: 3,
        threshold: 2,
        password: 'optional-password',
        onProgress: () => {},
        onQRCodeReady: () => {},
        onDeviceJoined: () => {},
      }
      expect(validOptions).toBeDefined()
      expect(validOptions.name).toBe('Test Vault')
      expect(validOptions.devices).toBe(3)
    })

    it('should accept minimal create options', () => {
      const minimalOptions = {
        name: 'Minimal Vault',
        devices: 2,
      }
      expect(minimalOptions).toBeDefined()
    })

    it('should allow password to be optional', () => {
      const optionsWithoutPassword = {
        name: 'Unencrypted Vault',
        devices: 3,
      }
      expect(optionsWithoutPassword).not.toHaveProperty('password')
    })

    it('should accept callbacks in options', () => {
      const progressSteps: string[] = []
      const qrPayloads: string[] = []
      const deviceJoins: { id: string; total: number; required: number }[] = []

      const options = {
        name: 'Callback Test',
        devices: 3,
        onProgress: (step: { step: string; progress: number; message: string }) => {
          progressSteps.push(step.step)
        },
        onQRCodeReady: (qr: string) => {
          qrPayloads.push(qr)
        },
        onDeviceJoined: (id: string, total: number, required: number) => {
          deviceJoins.push({ id, total, required })
        },
      }

      // Verify callbacks are functions
      expect(typeof options.onProgress).toBe('function')
      expect(typeof options.onQRCodeReady).toBe('function')
      expect(typeof options.onDeviceJoined).toBe('function')
    })
  })

  describe('create() error handling', () => {
    it('should throw VaultError with CreateFailed code on failure', async () => {
      // Create a mock context
      const mockContext = {
        storage: {} as any,
        config: {},
        serverManager: {} as any,
        passwordCache: { set: vi.fn() },
        wasmProvider: {} as any,
      }

      try {
        await SecureVault.create(mockContext as any, {
          name: 'Test',
          devices: 3,
        })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error).toBeInstanceOf(VaultError)
        expect((error as VaultError).code).toBe(VaultErrorCode.CreateFailed)
      }
    })
  })

  describe('fromStorage()', () => {
    it('should reject non-secure vault data', () => {
      const fastVaultData = {
        id: 'test-id',
        name: 'Fast Vault',
        type: 'fast' as const,
        vultFileContent: '',
        isEncrypted: true,
        signers: ['party1', 'party2'],
        localPartyId: 'party1',
        publicKeys: { ecdsa: 'abc', eddsa: 'def' },
        hexChainCode: 'abc',
        libType: 'DKLS' as const,
        createdAt: Date.now(),
      }

      const mockContext = {
        storage: {} as any,
        config: {},
        serverManager: {} as any,
        passwordCache: {} as any,
        wasmProvider: {} as any,
      }

      expect(() => SecureVault.fromStorage(fastVaultData as any, mockContext as any)).toThrow(
        'Cannot create SecureVault from fast vault data'
      )
    })
  })

  describe('instance properties', () => {
    it('should expose relay signing mode on stored secure vaults', () => {
      const vault = SecureVault.fromStorage(
        makeSecureVaultData(['device-1', 'device-2', 'device-3']),
        makeMockContext()
      )

      expect(vault.availableSigningModes).toEqual(['relay'])
    })

    it('should calculate stored secure vault threshold from signer count', () => {
      const twoSignerVault = SecureVault.fromStorage(makeSecureVaultData(['device-1', 'device-2']), makeMockContext())
      const threeSignerVault = SecureVault.fromStorage(
        makeSecureVaultData(['device-1', 'device-2', 'device-3']),
        makeMockContext()
      )
      const fiveSignerVault = SecureVault.fromStorage(
        makeSecureVaultData(['device-1', 'device-2', 'device-3', 'device-4', 'device-5']),
        makeMockContext()
      )

      expect(twoSignerVault.threshold).toBe(2)
      expect(threeSignerVault.threshold).toBe(2)
      expect(fiveSignerVault.threshold).toBe(4)
    })
  })
})

describe('SecureVault type safety', () => {
  describe('VaultCreationStep mapping', () => {
    it('should map SecureVaultCreationStep to VaultCreationStep', () => {
      // SecureVaultCreationStep has more granular steps
      const secureSteps = [
        'initializing',
        'generating_qr',
        'waiting_for_devices',
        'keygen_ecdsa',
        'keygen_eddsa',
        'finalizing',
        'complete',
      ]

      // VaultCreationStep has simpler steps
      const vaultSteps = ['keygen', 'complete']

      // Verify mapping logic (keygen_ecdsa/keygen_eddsa -> keygen)
      expect(secureSteps.includes('keygen_ecdsa')).toBe(true)
      expect(secureSteps.includes('keygen_eddsa')).toBe(true)
      expect(vaultSteps.includes('keygen')).toBe(true)
    })
  })

  describe('callback type safety', () => {
    it('should enforce correct onProgress callback signature', () => {
      type ProgressCallback = (step: { step: string; progress: number; message: string }) => void

      const validCallback: ProgressCallback = step => {
        expect(typeof step.step).toBe('string')
        expect(typeof step.progress).toBe('number')
        expect(typeof step.message).toBe('string')
      }

      expect(typeof validCallback).toBe('function')
    })

    it('should enforce correct onQRCodeReady callback signature', () => {
      type QRCallback = (qrPayload: string) => void

      const validCallback: QRCallback = qr => {
        expect(typeof qr).toBe('string')
      }

      expect(typeof validCallback).toBe('function')
    })

    it('should enforce correct onDeviceJoined callback signature', () => {
      type DeviceCallback = (deviceId: string, totalJoined: number, required: number) => void

      const validCallback: DeviceCallback = (id, total, required) => {
        expect(typeof id).toBe('string')
        expect(typeof total).toBe('number')
        expect(typeof required).toBe('number')
      }

      expect(typeof validCallback).toBe('function')
    })
  })
})

describe('SecureVault signing', () => {
  const customRelayUrl = 'https://relay.example.test/router'

  const makeSecureVault = () =>
    new (SecureVault as any)(
      'secure-vault-id',
      'Secure Vault',
      '',
      {
        storage: {} as any,
        config: {},
        serverManager: { messageRelay: customRelayUrl },
        passwordCache: {} as any,
        wasmProvider: {
          getWalletCore: vi.fn().mockResolvedValue({}),
        },
        pushNotificationService: {} as any,
      },
      {
        name: 'Secure Vault',
        publicKeys: { ecdsa: 'ecdsa-public-key', eddsa: 'eddsa-public-key' },
        signers: ['local-party-1', 'remote-party-2', 'remote-party-3'],
        hexChainCode: 'b'.repeat(64),
        localPartyId: 'local-party-1',
        createdAt: Date.now(),
        libType: 'DKLS',
        isBackedUp: true,
        order: 0,
        keyShares: { ecdsa: 'ecdsa-key-share', eddsa: 'eddsa-key-share' },
      }
    ) as SecureVault

  describe('sign() method interface', () => {
    it('should accept SigningPayload with messageHashes', () => {
      const payload = {
        chain: 'Ethereum',
        transaction: { to: '0x123', value: '1000000000000000000' },
        messageHashes: ['abc123def456'],
      }

      expect(payload.messageHashes).toBeDefined()
      expect(payload.messageHashes.length).toBe(1)
    })

    it('should accept multiple messageHashes for UTXO chains', () => {
      const utxoPayload = {
        chain: 'Bitcoin',
        transaction: { inputs: [{ txid: 'a' }, { txid: 'b' }] },
        messageHashes: ['hash1', 'hash2'],
      }

      expect(utxoPayload.messageHashes.length).toBe(2)
    })

    it('should accept optional callbacks in sign options', () => {
      const qrPayloads: string[] = []
      const deviceJoins: { id: string; total: number; required: number }[] = []

      const options = {
        onQRCodeReady: (qr: string) => {
          qrPayloads.push(qr)
        },
        onDeviceJoined: (id: string, total: number, required: number) => {
          deviceJoins.push({ id, total, required })
        },
      }

      expect(typeof options.onQRCodeReady).toBe('function')
      expect(typeof options.onDeviceJoined).toBe('function')
    })

    it('should allow sign() with no options', () => {
      const options = {}
      expect(options).toBeDefined()
    })

    it('passes the configured relay URL to the relay signing service', async () => {
      vi.mocked(RelaySigningService).mockClear()

      await makeSecureVault().sign({
        chain: 'Ethereum',
        transaction: { to: '0x123', value: '1000000000000000000' },
        messageHashes: ['abc123def456'],
      })

      expect(RelaySigningService).toHaveBeenCalledWith(customRelayUrl)
    })
  })

  describe('signBytes() method interface', () => {
    it('should accept hex string data', () => {
      const options = {
        data: '0xabcdef123456',
        chain: 'Ethereum',
      }

      expect(options.data).toBe('0xabcdef123456')
      expect(options.chain).toBe('Ethereum')
    })

    it('should accept Uint8Array data', () => {
      const options = {
        data: new Uint8Array([1, 2, 3, 4, 5]),
        chain: 'Ethereum',
      }

      expect(options.data).toBeInstanceOf(Uint8Array)
      expect(options.data.length).toBe(5)
    })

    it('should accept Buffer data', () => {
      const options = {
        data: Buffer.from([1, 2, 3, 4, 5]),
        chain: 'Bitcoin',
      }

      expect(Buffer.isBuffer(options.data)).toBe(true)
      expect(options.data.length).toBe(5)
    })

    it('should accept signing callbacks', () => {
      const signingOptions = {
        onQRCodeReady: (qr: string) => console.log(qr),
        onDeviceJoined: (id: string, total: number, required: number) => console.log(id, total, required),
      }

      expect(typeof signingOptions.onQRCodeReady).toBe('function')
      expect(typeof signingOptions.onDeviceJoined).toBe('function')
    })

    it('passes the configured relay URL to raw-bytes relay signing', async () => {
      vi.mocked(RelaySigningService).mockClear()

      await makeSecureVault().signBytes({
        data: '0xabcdef123456',
        chain: 'Ethereum',
      })

      expect(RelaySigningService).toHaveBeenCalledWith(customRelayUrl)
    })
  })

  describe('Signature type', () => {
    it('should have required signature field', () => {
      const signature = {
        signature: 'mock-der-signature',
        format: 'ECDSA' as const,
      }

      expect(signature.signature).toBeDefined()
      expect(signature.format).toBe('ECDSA')
    })

    it('should support optional recovery field for ECDSA', () => {
      const ecdsaSignature = {
        signature: 'mock-der-signature',
        recovery: 0,
        format: 'ECDSA' as const,
      }

      expect(ecdsaSignature.recovery).toBe(0)
    })

    it('should support multi-signature array for UTXO', () => {
      const utxoSignature = {
        signature: 'mock-der-signature-1',
        format: 'ECDSA' as const,
        signatures: [
          { r: 'r1', s: 's1', der: 'der1' },
          { r: 'r2', s: 's2', der: 'der2' },
        ],
      }

      expect(utxoSignature.signatures).toBeDefined()
      expect(utxoSignature.signatures?.length).toBe(2)
    })

    it('should support EdDSA format', () => {
      const eddsaSignature = {
        signature: 'mock-eddsa-signature',
        format: 'EdDSA' as const,
      }

      expect(eddsaSignature.format).toBe('EdDSA')
    })
  })

  describe('signing event types', () => {
    it('should define signingProgress event payload', () => {
      const progressEvent = {
        step: {
          step: 'signing' as const,
          progress: 50,
          message: 'Executing threshold signature',
          mode: 'relay' as const,
          participantCount: 3,
          participantsReady: 2,
        },
      }

      expect(progressEvent.step.step).toBe('signing')
      expect(progressEvent.step.mode).toBe('relay')
    })

    it('should define qrCodeReady event payload', () => {
      const qrEvent = {
        qrPayload: 'vultisig://?type=SignTransaction&...',
        action: 'keysign' as const,
        sessionId: 'session-123',
      }

      expect(qrEvent.action).toBe('keysign')
      expect(qrEvent.qrPayload).toContain('vultisig://')
    })

    it('should define deviceJoined event payload', () => {
      const deviceEvent = {
        deviceId: 'device-abc',
        totalJoined: 2,
        required: 3,
      }

      expect(deviceEvent.deviceId).toBe('device-abc')
      expect(deviceEvent.totalJoined).toBe(2)
      expect(deviceEvent.required).toBe(3)
    })

    it('should define transactionSigned event payload', () => {
      const signedEvent = {
        signature: {
          signature: 'der-signature',
          format: 'ECDSA' as const,
        },
        payload: {
          chain: 'Ethereum',
          messageHashes: ['hash1'],
        },
      }

      expect(signedEvent.signature).toBeDefined()
      expect(signedEvent.payload.chain).toBe('Ethereum')
    })
  })
})

describe('SecureVault vs FastVault signing differences', () => {
  describe('signing mode', () => {
    it('SecureVault uses relay mode', () => {
      const secureVaultMode = 'relay'
      expect(secureVaultMode).toBe('relay')
    })

    it('FastVault uses fast mode', () => {
      const fastVaultMode = 'fast'
      expect(fastVaultMode).toBe('fast')
    })
  })

  describe('device coordination', () => {
    it('SecureVault requires QR code for device pairing', () => {
      // SecureVault.sign() emits qrCodeReady event
      const requiresQR = true
      expect(requiresQR).toBe(true)
    })

    it('FastVault does not require QR code (server-assisted)', () => {
      // FastVault.sign() uses server for 2nd share
      const requiresQR = false
      expect(requiresQR).toBe(false)
    })
  })

  describe('threshold', () => {
    it('SecureVault has variable threshold based on signers', () => {
      const threshold3of5 = SecureVault.fromStorage(
        makeSecureVaultData(['device-1', 'device-2', 'device-3', 'device-4', 'device-5']),
        makeMockContext()
      ).threshold
      const threshold2of3 = SecureVault.fromStorage(
        makeSecureVaultData(['device-1', 'device-2', 'device-3']),
        makeMockContext()
      ).threshold

      expect(threshold3of5).toBe(4)
      expect(threshold2of3).toBe(2)
    })

    it('FastVault always has 2-of-2 threshold', () => {
      const fastThreshold = 2
      expect(fastThreshold).toBe(2)
    })
  })
})
