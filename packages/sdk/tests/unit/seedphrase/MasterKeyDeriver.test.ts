/**
 * Unit Tests: MasterKeyDeriver
 *
 * Tests key derivation functionality with mocked WalletCore.
 * Verifies correct public key types are used for EdDSA vs ECDSA chains.
 */

import { describe, expect, it, vi } from 'vitest'

import type { WasmProvider } from '../../../src/context/WasmProvider'
import { MasterKeyDeriver } from '../../../src/seedphrase/MasterKeyDeriver'

// Track which public key method was called
type PublicKeyCall = 'secp256k1' | 'ed25519' | 'ed25519Cardano'

const createMockWalletCore = () => {
  let lastPublicKeyCall: PublicKeyCall | null = null

  const mockPublicKey = {
    data: () => new Uint8Array(33).fill(0x02), // compressed secp256k1 format
  }

  const mockPrivateKey = {
    data: () => new Uint8Array(32).fill(0xab),
    getPublicKeySecp256k1: vi.fn((_compressed: boolean) => {
      lastPublicKeyCall = 'secp256k1'
      return mockPublicKey
    }),
    getPublicKeyEd25519: vi.fn(() => {
      lastPublicKeyCall = 'ed25519'
      return mockPublicKey
    }),
    getPublicKeyEd25519Cardano: vi.fn(() => {
      lastPublicKeyCall = 'ed25519Cardano'
      return mockPublicKey
    }),
  }

  const mockHdWallet = {
    getKeyForCoin: vi.fn(() => mockPrivateKey),
    getAddressForCoin: vi.fn(() => '0xMockAddress'),
    getMasterKey: vi.fn(() => mockPrivateKey),
    getExtendedPrivateKey: vi.fn(() => 'xprv...'),
    delete: vi.fn(),
  }

  return {
    walletCore: {
      HDWallet: {
        createWithMnemonic: vi.fn(() => mockHdWallet),
      },
      Mnemonic: {
        isValid: () => true,
      },
      CoinType: {
        bitcoin: 1, // Use 1 instead of 0 to avoid falsy check issue
        ethereum: 60,
        solana: 501,
        sui: 784,
        polkadot: 354,
        ton: 607,
        cardano: 1815,
        cosmos: 118,
        thorchain: 931,
        litecoin: 2,
      },
      Curve: {
        secp256k1: 'secp256k1',
        ed25519: 'ed25519',
      },
      Purpose: {
        bip44: 44,
      },
      HDVersion: {
        xprv: 'xprv',
      },
    },
    mockPrivateKey,
    getLastPublicKeyCall: () => lastPublicKeyCall,
    resetPublicKeyCall: () => {
      lastPublicKeyCall = null
    },
  }
}

const createMockWasmProvider = (mockWalletCore: ReturnType<typeof createMockWalletCore>): WasmProvider => ({
  getWalletCore: vi.fn().mockResolvedValue(mockWalletCore.walletCore),
  getDkls: vi.fn(),
  getSchnorr: vi.fn(),
  ensureInitialized: vi.fn(),
})

describe('MasterKeyDeriver', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  describe('deriveChainKey - public key type selection', () => {
    it('should use secp256k1 public key for ECDSA chains (Bitcoin)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Bitcoin', false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
      expect(mock.mockPrivateKey.getPublicKeySecp256k1).toHaveBeenCalledWith(true) // compressed
    })

    it('should use secp256k1 public key for ECDSA chains (Ethereum)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Ethereum', false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })

    it('should use ed25519 public key for EdDSA chains (Solana)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Solana', true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
      expect(mock.mockPrivateKey.getPublicKeyEd25519).toHaveBeenCalled()
    })

    it('should use ed25519 public key for EdDSA chains (Sui)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Sui', true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('should use ed25519 public key for EdDSA chains (Polkadot)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Polkadot', true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('should use ed25519 public key for EdDSA chains (Ton)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Ton', true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('should use ed25519Cardano public key for Cardano', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Cardano', true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519Cardano')
      expect(mock.mockPrivateKey.getPublicKeyEd25519Cardano).toHaveBeenCalled()
    })

    it('should use secp256k1 for Cosmos chains (ECDSA)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Cosmos', false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })

    it('should use secp256k1 for THORChain (ECDSA)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'THORChain', false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })
  })

  describe('deriveChainKey - return values', () => {
    it('should return chain key with all required fields', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      const result = await deriver.deriveChainKey(testMnemonic, 'Bitcoin', false)

      expect(result).toHaveProperty('chain', 'Bitcoin')
      expect(result).toHaveProperty('privateKeyHex')
      expect(result).toHaveProperty('publicKeyHex')
      expect(result).toHaveProperty('address')
      expect(result).toHaveProperty('isEddsa', false)
    })

    it('should return isEddsa=true for EdDSA chains', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      const result = await deriver.deriveChainKey(testMnemonic, 'Solana', true)

      expect(result.isEddsa).toBe(true)
    })
  })

  describe('deriveChainKey - cleanup', () => {
    it('should delete HDWallet after derivation', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, 'Bitcoin', false)

      const hdWallet = mock.walletCore.HDWallet.createWithMnemonic.mock.results[0].value
      expect(hdWallet.delete).toHaveBeenCalled()
    })
  })
})
