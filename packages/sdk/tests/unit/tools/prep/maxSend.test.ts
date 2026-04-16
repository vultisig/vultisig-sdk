import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetCoinBalance, mockGetSendFeeEstimate, mockGetPublicKey, mockIsValidAddress, mockGetWalletCore } =
  vi.hoisted(() => ({
    mockGetCoinBalance: vi.fn(),
    mockGetSendFeeEstimate: vi.fn(),
    mockGetPublicKey: vi.fn(),
    mockIsValidAddress: vi.fn(),
    mockGetWalletCore: vi.fn(),
  }))

vi.mock('@vultisig/core-chain/coin/balance', () => ({
  getCoinBalance: mockGetCoinBalance,
}))
vi.mock('@vultisig/core-mpc/keysign/send/getSendFeeEstimate', () => ({
  getSendFeeEstimate: mockGetSendFeeEstimate,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@vultisig/core-chain/utils/isValidAddress', () => ({
  isValidAddress: mockIsValidAddress,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))
vi.mock('@vultisig/mpc-types', () => ({
  getMpcEngine: vi.fn(),
}))

import { getMaxSendAmountFromKeys } from '@/tools/prep/maxSend'
import type { VaultIdentity } from '@/tools/prep/types'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
const mockPublicKey = { __mock: 'publicKey' }

describe('getMaxSendAmountFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockIsValidAddress.mockReturnValue(true)
    mockGetPublicKey.mockReturnValue(mockPublicKey)
  })

  it('returns balance, fee, and maxSendable for native ETH', async () => {
    const balance = 1_000_000_000_000_000_000n
    const fee = 21_000n * 30_000_000_000n
    mockGetCoinBalance.mockResolvedValue(balance)
    mockGetSendFeeEstimate.mockResolvedValue(fee)

    const coin = {
      chain: Chain.Ethereum,
      address: '0xfrom',
      decimals: 18,
      ticker: 'ETH',
    } as any

    const result = await getMaxSendAmountFromKeys(baseIdentity, {
      coin,
      receiver: '0xto',
    })

    expect(result).toEqual({
      balance,
      fee,
      maxSendable: balance - fee,
    })

    expect(mockGetCoinBalance).toHaveBeenCalledTimes(1)
    expect(mockGetCoinBalance).toHaveBeenCalledWith(coin)
  })

  it('forwards token coin (with id) to getCoinBalance for ERC-20 max', async () => {
    const balance = 5_000_000n
    const fee = 1_500_000n
    mockGetCoinBalance.mockResolvedValue(balance)
    mockGetSendFeeEstimate.mockResolvedValue(fee)

    const tokenCoin = {
      chain: Chain.Ethereum,
      address: '0xfrom',
      id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      decimals: 6,
      ticker: 'USDC',
    } as any

    const result = await getMaxSendAmountFromKeys(baseIdentity, {
      coin: tokenCoin,
      receiver: '0xto',
    })

    expect(mockGetCoinBalance).toHaveBeenCalledWith(tokenCoin)
    expect(mockGetCoinBalance.mock.calls[0][0].id).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(result.balance).toBe(balance)
    expect(result.fee).toBe(fee)
    expect(result.maxSendable).toBe(balance - fee)
  })

  it('returns maxSendable === 0n when fee exceeds balance', async () => {
    const balance = 1000n
    const fee = 5000n
    mockGetCoinBalance.mockResolvedValue(balance)
    mockGetSendFeeEstimate.mockResolvedValue(fee)

    const result = await getMaxSendAmountFromKeys(baseIdentity, {
      coin: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        decimals: 18,
        ticker: 'ETH',
      } as any,
      receiver: '0xto',
    })

    expect(result.balance).toBe(balance)
    expect(result.fee).toBe(fee)
    expect(result.maxSendable).toBe(0n)
  })

  it('rejects when receiver address is invalid', async () => {
    mockIsValidAddress.mockReturnValue(false)

    await expect(
      getMaxSendAmountFromKeys(baseIdentity, {
        coin: {
          chain: Chain.Ethereum,
          address: '0xfrom',
          decimals: 18,
          ticker: 'ETH',
        } as any,
        receiver: 'not-an-address',
      })
    ).rejects.toThrow('Invalid receiver address for chain Ethereum: not-an-address')

    expect(mockGetCoinBalance).not.toHaveBeenCalled()
    expect(mockGetSendFeeEstimate).not.toHaveBeenCalled()
  })

  it('passes identity fields and balance as amount to getSendFeeEstimate', async () => {
    const balance = 2_500_000_000_000_000_000n
    const fee = 100_000n
    mockGetCoinBalance.mockResolvedValue(balance)
    mockGetSendFeeEstimate.mockResolvedValue(fee)

    await getMaxSendAmountFromKeys(baseIdentity, {
      coin: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        decimals: 18,
        ticker: 'ETH',
      } as any,
      receiver: '0xto',
      memo: 'hello',
    })

    expect(mockGetSendFeeEstimate).toHaveBeenCalledTimes(1)
    const call = mockGetSendFeeEstimate.mock.calls[0][0]
    expect(call).toMatchObject({
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      amount: balance,
      receiver: '0xto',
      memo: 'hello',
      publicKey: mockPublicKey,
      hexPublicKeyOverride: undefined,
      walletCore: mockWalletCore,
    })
  })

  it('passes publicKey: null and hexPublicKeyOverride for QBTC', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      publicKeyMldsa: 'mldsa-pubkey-hex',
    }
    mockGetCoinBalance.mockResolvedValue(10_000n)
    mockGetSendFeeEstimate.mockResolvedValue(500n)

    await getMaxSendAmountFromKeys(identity, {
      coin: {
        chain: Chain.QBTC,
        address: 'qbtc-from',
        decimals: 8,
        ticker: 'QBTC',
      } as any,
      receiver: 'qbtc-to',
    })

    expect(mockGetPublicKey).not.toHaveBeenCalled()
    const call = mockGetSendFeeEstimate.mock.calls[0][0]
    expect(call.publicKey).toBeNull()
    expect(call.hexPublicKeyOverride).toBe('mldsa-pubkey-hex')
  })
})
