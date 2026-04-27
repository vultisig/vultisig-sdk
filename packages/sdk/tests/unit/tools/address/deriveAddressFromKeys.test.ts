import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWalletCore, mockGetPublicKey, mockDeriveAddress } = vi.hoisted(() => ({
  mockGetWalletCore: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockDeriveAddress: vi.fn(),
}))

vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/publicKey/address/deriveAddress', () => ({
  deriveAddress: mockDeriveAddress,
}))

import { deriveAddressFromKeys } from '@/tools/address/deriveAddressFromKeys'

const mockWalletCore = { __mock: 'walletCore' }
const mockPublicKey = { __mock: 'publicKey' }

describe('deriveAddressFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
    mockDeriveAddress.mockReturnValue('0xabc123')
  })

  it('throws when neither ecdsa nor eddsa key', async () => {
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        hexChainCode: '00',
      })
    ).rejects.toThrow('At least one public key (ecdsaPublicKey or eddsaPublicKey) is required')
  })

  it('throws when hexChainCode empty', async () => {
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        ecdsaPublicKey: '02hex',
        hexChainCode: '',
      })
    ).rejects.toThrow('hexChainCode is required for address derivation')
  })

  it('when getWalletCore rejects, error message mentions WalletCore init', async () => {
    mockGetWalletCore.mockRejectedValueOnce(new Error('bootstrap failed'))
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Ethereum,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to initialize WalletCore for address derivation/)
  })

  it('when getPublicKey throws, error mentions chain name', async () => {
    mockGetPublicKey.mockImplementationOnce(() => {
      throw new Error('key derivation error')
    })
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Solana,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to derive public key for Solana:/)
  })

  it('when deriveAddress throws, error mentions chain', async () => {
    mockDeriveAddress.mockImplementationOnce(() => {
      throw new Error('address derivation error')
    })
    await expect(
      deriveAddressFromKeys({
        chain: Chain.Bitcoin,
        ecdsaPublicKey: '02hex',
        hexChainCode: 'cafe',
      })
    ).rejects.toThrow(/Failed to derive address for Bitcoin:/)
  })

  it('returns chain and address on success', async () => {
    const address = 'bc1qdummy'
    mockDeriveAddress.mockReturnValueOnce(address)
    const result = await deriveAddressFromKeys({
      chain: Chain.Bitcoin,
      ecdsaPublicKey: '02hex',
      hexChainCode: 'cafe',
    })
    expect(result).toEqual({ chain: Chain.Bitcoin, address })
    expect(mockGetWalletCore).toHaveBeenCalledTimes(1)
    expect(mockGetPublicKey).toHaveBeenCalledWith({
      chain: Chain.Bitcoin,
      walletCore: mockWalletCore,
      hexChainCode: 'cafe',
      publicKeys: {
        ecdsa: '02hex',
        eddsa: '',
      },
    })
    expect(mockDeriveAddress).toHaveBeenCalledWith({
      chain: Chain.Bitcoin,
      publicKey: mockPublicKey,
      walletCore: mockWalletCore,
    })
  })
})
