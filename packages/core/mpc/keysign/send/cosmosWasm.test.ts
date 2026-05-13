import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { describe, expect, it } from 'vitest'

import { getCosmosWasmTokenTransferPayload } from './cosmosWasm'

const baseCoin: AccountCoin = {
  chain: Chain.Terra,
  id: 'terra1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2s5lvsct',
  address: 'terra1sender000000000000000000000000000000000',
  ticker: 'ampLUNA',
  decimals: 6,
}

describe('getCosmosWasmTokenTransferPayload', () => {
  it('builds a CW20 transfer execute payload for Terra tokens', () => {
    const payload = getCosmosWasmTokenTransferPayload({
      coin: baseCoin,
      receiver: 'terra1receiver000000000000000000000000000000',
      amount: 123456n,
    })

    expect(payload).toEqual(
      expect.objectContaining({
        senderAddress: baseCoin.address,
        contractAddress: baseCoin.id,
        executeMsg: '{"transfer":{"recipient":"terra1receiver000000000000000000000000000000","amount":"123456"}}',
        coins: [],
      })
    )
  })

  it('does not treat IBC denoms as CW20 contracts', () => {
    expect(
      getCosmosWasmTokenTransferPayload({
        coin: {
          ...baseCoin,
          id: 'ibc/8D8A7F7253615E5F76CB6252A1E1BD921D5EDB7BBAAF8913FB1C77FF125D9995',
        },
        receiver: 'terra1receiver000000000000000000000000000000',
        amount: 1n,
      })
    ).toBeUndefined()
  })

  it('does not build contract payloads for vault-based cosmos chains', () => {
    expect(
      getCosmosWasmTokenTransferPayload({
        coin: {
          ...baseCoin,
          chain: Chain.THORChain,
          id: 'thor1ecgazyd0waaj3g7l9cmy5gulhxkps2gmxu9ghducvuypjq68mq2',
        },
        receiver: 'thor1receiver000000000000000000000000000000',
        amount: 1n,
      })
    ).toBeUndefined()
  })
})
