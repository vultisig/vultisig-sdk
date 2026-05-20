import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

import { Chain } from '@vultisig/core-chain/Chain'
import { clearCosmosTokenMetadataCacheForTests, getCosmosTokenMetadata } from './cosmos'

describe('getCosmosTokenMetadata', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
    clearCosmosTokenMetadataCacheForTests()
  })

  it('fetches Terra CW20 metadata from token_info', async () => {
    const contractAddress = 'terra1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2s5lvsct'
    queryUrlMock.mockResolvedValue({
      data: {
        name: 'Eris Amplified LUNA',
        symbol: 'ampLUNA',
        decimals: 6,
        total_supply: '11768872973565',
      },
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Terra,
        id: contractAddress,
      })
    ).resolves.toEqual({
      ticker: 'ampLUNA',
      decimals: 6,
    })

    expect(queryUrlMock).toHaveBeenCalledWith(
      `https://terra-lcd.publicnode.com/cosmwasm/wasm/v1/contract/${contractAddress}/smart/eyJ0b2tlbl9pbmZvIjp7fX0=`
    )
  })

  it('keeps bank denom metadata resolution for non-CW20 denoms', async () => {
    queryUrlMock.mockResolvedValue({
      metadata: {
        symbol: 'USDC',
        display: 'USDC',
        denom_units: [
          {
            denom: 'uusdc',
            exponent: 0,
          },
          {
            denom: 'USDC',
            exponent: 6,
          },
        ],
      },
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Noble,
        id: 'uusdc',
      })
    ).resolves.toEqual({
      ticker: 'USDC',
      decimals: 6,
    })
  })

  it('accepts zero-decimal bank denoms', async () => {
    queryUrlMock.mockResolvedValue({
      metadata: {
        display: 'nft',
        denom_units: [
          {
            denom: 'nft',
            exponent: 0,
          },
        ],
      },
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Cosmos,
        id: 'unft',
      })
    ).resolves.toEqual({
      ticker: 'nft',
      decimals: 0,
    })
  })

  it('preserves known Cosmos token logo and price metadata', async () => {
    await expect(
      getCosmosTokenMetadata({
        chain: Chain.TerraClassic,
        id: 'uusd',
      })
    ).resolves.toEqual({
      ticker: 'USTC',
      decimals: 6,
      logo: 'ustc.png',
      priceProviderId: 'terrausd',
    })

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('resolves IBC denom traces through base denom metadata', async () => {
    queryUrlMock.mockImplementation((url: string) => {
      if (url.includes('/denoms_metadata/ibc%2FTRACEHASH')) {
        return Promise.resolve({ metadata: { base: 'ibc/TRACEHASH' } })
      }
      if (url.includes('/denoms_metadata?pagination.limit=1000')) {
        return Promise.resolve({ metadatas: [] })
      }
      if (url.includes('/denom_traces/TRACEHASH')) {
        return Promise.resolve({ denom_trace: { path: 'transfer/channel-1', base_denom: 'uatom' } })
      }
      if (url.includes('/denoms_metadata/uatom')) {
        return Promise.resolve({
          metadata: {
            symbol: 'ATOM',
            display: 'ATOM',
            denom_units: [
              {
                denom: 'uatom',
                exponent: 0,
              },
              {
                denom: 'ATOM',
                exponent: 6,
              },
            ],
          },
        })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Terra,
        id: 'ibc/TRACEHASH',
      })
    ).resolves.toEqual({
      ticker: 'ATOM',
      decimals: 6,
    })
  })

  it('uses IBC trace ticker fallback as hidden when base metadata is unavailable', async () => {
    queryUrlMock.mockImplementation((url: string) => {
      if (url.includes('/denoms_metadata/ibc%2FOSMOHASH')) {
        return Promise.resolve({ metadata: { base: 'ibc/OSMOHASH' } })
      }
      if (url.includes('/denom_traces/OSMOHASH')) {
        return Promise.resolve({ denom_trace: { path: 'transfer/channel-1', base_denom: 'uosmo' } })
      }
      if (url.includes('/denoms_metadata/uosmo')) {
        return Promise.resolve({ metadata: { base: 'uosmo' } })
      }
      if (url.includes('/denoms_metadata?pagination.limit=1000')) {
        return Promise.resolve({ metadatas: [] })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Terra,
        id: 'ibc/OSMOHASH',
      })
    ).resolves.toEqual({
      ticker: 'osmo',
      decimals: 6,
      isHidden: true,
    })
  })

  it('caches bank denom metadata lookups for 24 hours', async () => {
    queryUrlMock.mockResolvedValue({
      metadata: {
        symbol: 'CACHED',
        display: 'CACHED',
        denom_units: [
          {
            denom: 'ucached',
            exponent: 0,
          },
          {
            denom: 'CACHED',
            exponent: 8,
          },
        ],
      },
    })

    await getCosmosTokenMetadata({
      chain: Chain.Cosmos,
      id: 'ucached',
    })
    await getCosmosTokenMetadata({
      chain: Chain.Cosmos,
      id: 'ucached',
    })

    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('does not cache missing bank denom metadata', async () => {
    queryUrlMock.mockImplementation((url: string) => {
      if (url.includes('/denoms_metadata/uappears')) {
        if (
          queryUrlMock.mock.calls.filter(([calledUrl]) => String(calledUrl).includes('/denoms_metadata/uappears'))
            .length === 1
        ) {
          return Promise.resolve({})
        }

        return Promise.resolve({
          metadata: {
            symbol: 'APPEARS',
            display: 'APPEARS',
            denom_units: [
              {
                denom: 'uappears',
                exponent: 0,
              },
              {
                denom: 'APPEARS',
                exponent: 9,
              },
            ],
          },
        })
      }
      if (url.includes('/denoms_metadata?pagination.limit=1000')) {
        return Promise.resolve({ metadatas: [] })
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Terra,
        id: 'uappears',
      })
    ).rejects.toThrow('No denom meta information available')

    await expect(
      getCosmosTokenMetadata({
        chain: Chain.Terra,
        id: 'uappears',
      })
    ).resolves.toEqual({
      ticker: 'APPEARS',
      decimals: 9,
    })
  })
})
