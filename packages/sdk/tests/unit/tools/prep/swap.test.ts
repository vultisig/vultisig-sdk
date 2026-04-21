import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSwapKeysignPayload, mockGetPublicKey, mockGetWalletCore } = vi.hoisted(() => ({
  mockBuildSwapKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/swap/build', () => ({
  buildSwapKeysignPayload: mockBuildSwapKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareSwapTxFromKeys } from '@/tools/prep/swap'
import type { VaultIdentity } from '@/tools/prep/types'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
const mockFromPublicKey = { __mock: 'fromPublicKey' }
const mockToPublicKey = { __mock: 'toPublicKey' }

const ethCoin = {
  chain: Chain.Ethereum,
  address: '0xfrom',
  decimals: 18,
  ticker: 'ETH',
} as any

const thorCoin = {
  chain: Chain.THORChain,
  address: 'thor1from',
  decimals: 8,
  ticker: 'RUNE',
} as any

const btcCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1from',
  decimals: 8,
  ticker: 'BTC',
} as any

const swapQuoteStub = { __mock: 'swapQuote' } as any

describe('prepareSwapTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('calls getPublicKey for both fromCoin.chain and toCoin.chain (native swap THORChain -> BTC)', async () => {
    const payload = { __mock: 'nativePayload' }
    mockBuildSwapKeysignPayload.mockResolvedValue(payload)

    const result = await prepareSwapTxFromKeys(baseIdentity, {
      fromCoin: thorCoin,
      toCoin: btcCoin,
      amount: 10,
      swapQuote: swapQuoteStub,
    })

    expect(result).toBe(payload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(2)
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(1, {
      chain: Chain.THORChain,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(2, {
      chain: Chain.Bitcoin,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    expect(mockBuildSwapKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSwapKeysignPayload.mock.calls[0][0]
    expect(call).toMatchObject({
      fromCoin: thorCoin,
      toCoin: btcCoin,
      amount: 10,
      swapQuote: swapQuoteStub,
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      fromPublicKey: mockFromPublicKey,
      toPublicKey: mockToPublicKey,
      walletCore: mockWalletCore,
    })
  })

  it('uses the explicit walletCore override and does not call the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })

    await prepareSwapTxFromKeys(
      baseIdentity,
      {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: swapQuoteStub,
      },
      overrideWalletCore as any
    )

    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockBuildSwapKeysignPayload.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })

  it('forwards chainPublicKeys to getPublicKey for both fromCoin and toCoin (seedphrase-imported vault)', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      chainPublicKeys: {
        [Chain.Ethereum]: '03eth-per-chain',
        [Chain.Bitcoin]: '03btc-per-chain',
      },
    }
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })

    await prepareSwapTxFromKeys(identity, {
      fromCoin: ethCoin,
      toCoin: btcCoin,
      amount: '1',
      swapQuote: swapQuoteStub,
    })

    expect(mockGetPublicKey).toHaveBeenCalledTimes(2)
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chain: Chain.Ethereum,
        chainPublicKeys: identity.chainPublicKeys,
      })
    )
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chain: Chain.Bitcoin,
        chainPublicKeys: identity.chainPublicKeys,
      })
    )
  })
})
