/**
 * Unit Tests: MasterKeyDeriver
 *
 * Tests key derivation functionality with mocked WalletCore.
 * Verifies correct public key types are used for EdDSA vs ECDSA chains.
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

import type { WasmProvider } from '../../../src/context/SdkContext'
import { MasterKeyDeriver } from '../../../src/seedphrase/MasterKeyDeriver'

// Track which public key method was called
type PublicKeyCall = 'secp256k1' | 'ed25519' | 'ed25519Cardano'

const createMockWalletCore = () => {
  let lastPublicKeyCall: PublicKeyCall | null = null

  const mockPublicKey = {
    data: () => new Uint8Array(33).fill(0x02), // compressed secp256k1 format
    delete: vi.fn(),
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
    delete: vi.fn(),
  }

  const mockHdWallet = {
    getKeyForCoin: vi.fn(() => mockPrivateKey),
    getKey: vi.fn((_coinType: unknown, _path: string) => mockPrivateKey),
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
        terraV2: 10000330,
        terra: 330,
      },
      CoinTypeExt: {
        deriveAddressFromPublicKey: vi.fn((_coinType: unknown, _pubKey: unknown) => 'terra1mockcosmospathaddr'),
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
    mockHdWallet,
    getLastPublicKeyCall: () => lastPublicKeyCall,
    resetPublicKeyCall: () => {
      lastPublicKeyCall = null
    },
  }
}

const createMockWasmProvider = (mockWalletCore: ReturnType<typeof createMockWalletCore>): WasmProvider => ({
  getWalletCore: vi.fn().mockResolvedValue(mockWalletCore.walletCore),
})

describe('MasterKeyDeriver', () => {
  const testMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  describe('deriveChainKey - public key type selection', () => {
    it('rejects chains disabled for seedphrase import before loading WalletCore', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await expect(deriver.deriveChainKey(testMnemonic, Chain.Cardano, true)).rejects.toThrow(/Cardano/)
      expect(provider.getWalletCore).not.toHaveBeenCalled()
    })

    it('should use secp256k1 public key for ECDSA chains (Bitcoin)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Bitcoin, false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
      expect(mock.mockPrivateKey.getPublicKeySecp256k1).toHaveBeenCalledWith(true) // compressed
    })

    it('should use secp256k1 public key for ECDSA chains (Ethereum)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Ethereum, false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })

    it('should use ed25519 public key for EdDSA chains (Solana)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Solana, true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
      expect(mock.mockPrivateKey.getPublicKeyEd25519).toHaveBeenCalled()
    })

    it('should use ed25519 public key for EdDSA chains (Sui)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Sui, true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('should use ed25519 public key for EdDSA chains (Polkadot)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Polkadot, true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('should use ed25519 public key for EdDSA chains (Ton)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Ton, true)

      expect(mock.getLastPublicKeyCall()).toBe('ed25519')
    })

    it('rejects Cardano until seedphrase import has full signing support for it', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await expect(deriver.deriveChainKey(testMnemonic, Chain.Cardano, true)).rejects.toThrow(/Cardano/)

      expect(mock.getLastPublicKeyCall()).toBe(null)
      expect(mock.mockPrivateKey.getPublicKeyEd25519Cardano).not.toHaveBeenCalled()
    })

    it('should use secp256k1 for Cosmos chains (ECDSA)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Cosmos, false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })

    it('should use secp256k1 for THORChain (ECDSA)', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.THORChain, false)

      expect(mock.getLastPublicKeyCall()).toBe('secp256k1')
    })
  })

  describe('deriveChainKey - return values', () => {
    it('should return chain key with all required fields', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      const result = await deriver.deriveChainKey(testMnemonic, Chain.Bitcoin, false)

      expect(result).toHaveProperty('chain', Chain.Bitcoin)
      expect(result).toHaveProperty('privateKeyHex')
      expect(result).toHaveProperty('publicKeyHex')
      expect(result).toHaveProperty('address')
      expect(result).toHaveProperty('isEddsa', false)
    })

    it('should return isEddsa=true for EdDSA chains', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      const result = await deriver.deriveChainKey(testMnemonic, Chain.Solana, true)

      expect(result.isEddsa).toBe(true)
    })
  })

  describe('deriveChainKey - cleanup', () => {
    it('should delete HDWallet after derivation', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveChainKey(testMnemonic, Chain.Bitcoin, false)

      const hdWallet = mock.walletCore.HDWallet.createWithMnemonic.mock.results[0].value
      expect(hdWallet.delete).toHaveBeenCalled()
    })
  })

  describe('seedphrase import chain support', () => {
    it('rejects disabled chains when deriving multiple private keys', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await expect(deriver.deriveChainPrivateKeys(testMnemonic, [Chain.Ethereum, Chain.Cardano])).rejects.toThrow(
        /Cardano/
      )
      expect(provider.getWalletCore).not.toHaveBeenCalled()
    })

    it('rejects disabled chains when deriving addresses for discovery', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await expect(deriver.deriveAddress(testMnemonic, Chain.Cardano)).rejects.toThrow(/Cardano/)
      expect(provider.getWalletCore).not.toHaveBeenCalled()
    })
  })

  describe('deriveTerraAddressWithCosmosPath', () => {
    it('should derive a terra1... address using the Cosmos coin-type path', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      const address = await deriver.deriveTerraAddressWithCosmosPath(testMnemonic)

      expect(address).toBe('terra1mockcosmospathaddr')
    })

    it("should call getKey with terraV2 coin type and m/44'/118'/0'/0/0 path", async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveTerraAddressWithCosmosPath(testMnemonic)

      expect(mock.mockHdWallet.getKey).toHaveBeenCalledWith(mock.walletCore.CoinType.terraV2, "m/44'/118'/0'/0/0")
    })

    it('should use secp256k1 compressed public key for address derivation', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveTerraAddressWithCosmosPath(testMnemonic)

      expect(mock.mockPrivateKey.getPublicKeySecp256k1).toHaveBeenCalledWith(true) // compressed
    })

    it('should clean up private key and public key objects', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveTerraAddressWithCosmosPath(testMnemonic)

      expect(mock.mockPrivateKey.delete).toHaveBeenCalled()
    })

    it('should delete HDWallet after derivation', async () => {
      const mock = createMockWalletCore()
      const provider = createMockWasmProvider(mock)
      const deriver = new MasterKeyDeriver(provider)

      await deriver.deriveTerraAddressWithCosmosPath(testMnemonic)

      const hdWallet = mock.walletCore.HDWallet.createWithMnemonic.mock.results[0].value
      expect(hdWallet.delete).toHaveBeenCalled()
    })
  })
})
