import { OtherChain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCoinMetadataMock = vi.fn()

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ getCoinMetadata: getCoinMetadataMock }),
}))

import { getSuiTokenMetadata } from './sui'

describe('getSuiTokenMetadata', () => {
  beforeEach(() => {
    getCoinMetadataMock.mockReset()
  })

  it('maps SUI coin metadata into CoinMetadata', async () => {
    const id = '0x2::sui::SUI'
    getCoinMetadataMock.mockResolvedValue({
      decimals: 9,
      symbol: 'SUI',
      name: 'Sui',
      description: 'Sui native coin',
      iconUrl: 'https://example.com/sui.png',
    })

    await expect(getSuiTokenMetadata({ chain: OtherChain.Sui, id })).resolves.toEqual({
      ticker: 'SUI',
      decimals: 9,
      logo: 'https://example.com/sui.png',
    })

    expect(getCoinMetadataMock).toHaveBeenCalledWith({ coinType: id })
  })

  it('omits the logo when iconUrl is missing', async () => {
    getCoinMetadataMock.mockResolvedValue({
      decimals: 6,
      symbol: 'USDC',
      name: 'USD Coin',
      description: '',
      iconUrl: null,
    })

    await expect(
      getSuiTokenMetadata({
        chain: OtherChain.Sui,
        id: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      })
    ).resolves.toEqual({
      ticker: 'USDC',
      decimals: 6,
      logo: undefined,
    })
  })

  it('throws when no metadata is returned for the coin type', async () => {
    getCoinMetadataMock.mockResolvedValue(null)

    await expect(getSuiTokenMetadata({ chain: OtherChain.Sui, id: '0x123::foo::BAR' })).rejects.toThrow()
  })
})
