import { describe, expect, it, vi } from 'vitest'

const getAllBalancesMock = vi.fn()

vi.mock('@vultisig/core-chain/chains/cosmos/client', () => ({
  getCosmosClient: () => ({
    getAllBalances: getAllBalancesMock,
  }),
}))

import { Chain } from '../../../Chain'
import { findCosmosCoins } from './cosmos'

describe('findCosmosCoins', () => {
  it('keeps known single-segment THORChain denoms like TCY', async () => {
    getAllBalancesMock.mockResolvedValue([
      { denom: 'rune', amount: '1' },
      { denom: 'tcy', amount: '2' },
    ])

    const coins = await findCosmosCoins({
      address: 'thor1address',
      chain: Chain.THORChain,
    })

    expect(coins).toEqual([
      expect.objectContaining({
        id: 'tcy',
        ticker: 'TCY',
        logo: 'tcy',
      }),
    ])
  })
})
