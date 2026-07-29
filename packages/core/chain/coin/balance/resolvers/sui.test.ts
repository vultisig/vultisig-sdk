import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBalanceMock = vi.fn()

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({ getBalance: getBalanceMock }),
}))

import { getSuiCoinBalance } from './sui'

const address = '0x0000000000000000000000000000000000000000000000000000000000000abc'

describe('getSuiCoinBalance', () => {
  beforeEach(() => getBalanceMock.mockReset())

  it('reads the total from the nested balance envelope', async () => {
    // The unified client returns `{ balance: { balance, coinBalance, addressBalance } }`.
    // `balance.balance` is the total (the retired JSON-RPC `totalBalance`) — reading
    // `coinBalance` or `addressBalance` would under-report a wallet.
    getBalanceMock.mockResolvedValueOnce({
      balance: {
        coinType: '0x2::sui::SUI',
        balance: '2227801536832',
        coinBalance: '2227801536832',
        addressBalance: '0',
      },
    })

    await expect(getSuiCoinBalance({ chain: Chain.Sui, address })).resolves.toBe(2227801536832n)
    expect(getBalanceMock).toHaveBeenCalledWith({ owner: address })
  })

  it('scopes the query to a coin type when one is given', async () => {
    const id = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
    getBalanceMock.mockResolvedValueOnce({
      balance: { coinType: id, balance: '42', coinBalance: '42', addressBalance: '0' },
    })

    await expect(getSuiCoinBalance({ chain: Chain.Sui, address, id })).resolves.toBe(42n)
    expect(getBalanceMock).toHaveBeenCalledWith({ owner: address, coinType: id })
  })
})
