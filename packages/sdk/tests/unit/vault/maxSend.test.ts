import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSendFeeEstimate, mockGetPublicKey, mockIsValidAddress } = vi.hoisted(() => ({
  mockGetSendFeeEstimate: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockIsValidAddress: vi.fn(),
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
vi.mock('@vultisig/mpc-types', () => ({
  getMpcEngine: vi.fn(),
}))

import { VaultBase } from '@/vault/VaultBase'

describe('VaultBase.getMaxSendAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidAddress.mockReturnValue(true)
    mockGetPublicKey.mockReturnValue({ __mock: 'publicKey' })
  })

  it('uses the balance service for both the token amount and native gas affordability', async () => {
    const tokenBalance = 16_140_000n
    const nativeBalance = 8_530_000_000_000_000_000n
    const fee = 20_000_000_000_000_000n
    const walletCore = { __mock: 'walletCore' }
    const tokenId = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const getBalance = vi.fn(async (_chain: Chain, id?: string) => ({
      amount: (id === undefined ? nativeBalance : tokenBalance).toString(),
    }))
    mockGetSendFeeEstimate.mockResolvedValue(fee)

    const vault = Object.create(VaultBase.prototype) as VaultBase
    Object.assign(vault as object, {
      wasmProvider: { getWalletCore: vi.fn().mockResolvedValue(walletCore) },
      balanceService: { getBalance },
      coreVault: {
        publicKeys: { ecdsa: '02ecdsa-public-key', eddsa: 'eddsa-public-key' },
        hexChainCode: 'deadbeef',
        localPartyId: 'iPhone-A1B2',
        libType: 'DKLS',
      },
    })

    const result = await vault.getMaxSendAmount({
      coin: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        id: tokenId,
        decimals: 6,
        ticker: 'USDC',
      },
      receiver: '0xto',
    })

    expect(getBalance).toHaveBeenCalledTimes(2)
    expect(getBalance).toHaveBeenCalledWith(Chain.Ethereum, tokenId)
    expect(getBalance).toHaveBeenCalledWith(Chain.Ethereum)
    expect(result).toEqual({ balance: tokenBalance, fee, maxSendable: tokenBalance })
  })
})
