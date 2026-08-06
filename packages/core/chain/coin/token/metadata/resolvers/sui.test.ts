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
    // The unified client nests the result under `coinMetadata`.
    getCoinMetadataMock.mockResolvedValue({
      coinMetadata: {
        id: '0xf256d3fb6a50eaa748d94335b34f2982fbc3b63ceec78cafaa29ebc9ebaf2bbc',
        decimals: 9,
        symbol: 'SUI',
        name: 'Sui',
        description: 'Sui native coin',
        iconUrl: 'https://example.com/sui.png',
      },
    })

    await expect(getSuiTokenMetadata({ chain: OtherChain.Sui, id })).resolves.toEqual({
      ticker: 'SUI',
      decimals: 9,
      logo: 'https://example.com/sui.png',
    })

    expect(getCoinMetadataMock).toHaveBeenCalledWith({ coinType: id })
  })

  it('omits the logo when iconUrl is null', async () => {
    getCoinMetadataMock.mockResolvedValue({
      coinMetadata: {
        id: null,
        decimals: 6,
        symbol: 'USDC',
        name: 'USD Coin',
        description: '',
        iconUrl: null,
      },
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

  it('omits the logo when iconUrl is the empty string', async () => {
    // gRPC and GraphQL both return '' (not null) for an absent icon — mainnet SUI
    // itself does. `??` would leak that empty string through as a logo URL.
    getCoinMetadataMock.mockResolvedValue({
      coinMetadata: { id: null, decimals: 9, symbol: 'SUI', name: 'Sui', description: '', iconUrl: '' },
    })

    await expect(getSuiTokenMetadata({ chain: OtherChain.Sui, id: '0x2::sui::SUI' })).resolves.toEqual({
      ticker: 'SUI',
      decimals: 9,
      logo: undefined,
    })
  })

  it('throws when no metadata is returned for the coin type', async () => {
    getCoinMetadataMock.mockResolvedValue({ coinMetadata: null })

    await expect(getSuiTokenMetadata({ chain: OtherChain.Sui, id: '0x123::foo::BAR' })).rejects.toThrow()
  })
})
