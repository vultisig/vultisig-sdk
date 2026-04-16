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

const usdcCoin = {
  chain: Chain.Ethereum,
  address: '0xfrom',
  decimals: 6,
  ticker: 'USDC',
  id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
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

const solCoin = {
  chain: Chain.Solana,
  address: 'sol-from',
  decimals: 9,
  ticker: 'SOL',
} as any

const usdcSolCoin = {
  chain: Chain.Solana,
  address: 'sol-from',
  decimals: 6,
  ticker: 'USDC',
  id: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
} as any

const swapQuoteStub = { __mock: 'swapQuote' } as any

describe('prepareSwapTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('returns the payload as-is when erc20ApprovePayload is set (EVM-to-EVM with approval)', async () => {
    const payloadWithApproval = {
      __mock: 'keysignPayload',
      erc20ApprovePayload: {
        amount: '1000000',
        spender: '0xrouter',
      },
    }
    mockBuildSwapKeysignPayload.mockResolvedValue(payloadWithApproval)

    const result = await prepareSwapTxFromKeys(baseIdentity, {
      fromCoin: usdcCoin,
      toCoin: ethCoin,
      amount: '1.5',
      swapQuote: swapQuoteStub,
    })

    expect(result).toBe(payloadWithApproval)
    expect((result as any).erc20ApprovePayload).toEqual({
      amount: '1000000',
      spender: '0xrouter',
    })
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

  it('passes eddsaPublicKey through publicKeys for Solana (EdDSA chain)', async () => {
    const payload = { __mock: 'solanaPayload' }
    mockBuildSwapKeysignPayload.mockResolvedValue(payload)

    const result = await prepareSwapTxFromKeys(baseIdentity, {
      fromCoin: solCoin,
      toCoin: usdcSolCoin,
      amount: '0.5',
      swapQuote: swapQuoteStub,
    })

    expect(result).toBe(payload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(2)
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(1, {
      chain: Chain.Solana,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(2, {
      chain: Chain.Solana,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    const call = mockBuildSwapKeysignPayload.mock.calls[0][0]
    expect(call.fromPublicKey).toBe(mockFromPublicKey)
    expect(call.toPublicKey).toBe(mockToPublicKey)
  })

  it('sources vaultId/localPartyId/libType from identity', async () => {
    const payload = { __mock: 'identityPayload' }
    mockBuildSwapKeysignPayload.mockResolvedValue(payload)

    const customIdentity: VaultIdentity = {
      ecdsaPublicKey: '02custom-ecdsa',
      eddsaPublicKey: 'custom-eddsa',
      hexChainCode: 'cafebabe',
      localPartyId: 'Android-Z9Y8',
      libType: 'GG20',
    }

    await prepareSwapTxFromKeys(customIdentity, {
      fromCoin: ethCoin,
      toCoin: usdcCoin,
      amount: '2',
      swapQuote: swapQuoteStub,
    })

    expect(mockBuildSwapKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSwapKeysignPayload.mock.calls[0][0]
    expect(call.vaultId).toBe(customIdentity.ecdsaPublicKey)
    expect(call.localPartyId).toBe(customIdentity.localPartyId)
    expect(call.libType).toBe(customIdentity.libType)
  })
})
