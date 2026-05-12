import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrlMock(...args),
}))

import { Chain } from '../../../../Chain'
import { getCosmosTokenMetadata } from './cosmos'

describe('getCosmosTokenMetadata', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
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
})
