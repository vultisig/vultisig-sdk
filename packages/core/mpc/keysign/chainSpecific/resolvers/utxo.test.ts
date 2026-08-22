import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/utxo/fee/byteFee', () => ({
  getUtxoByteFee: vi.fn(async () => 5n),
}))

import { getUtxoChainSpecific } from './utxo'

const payload = create(KeysignPayloadSchema, {
  coin: create(CoinSchema, {
    chain: Chain.Bitcoin,
    ticker: 'BTC',
    address: 'bc1qsource',
    decimals: 8,
    isNativeToken: true,
  }),
  toAddress: 'bc1qdest',
  toAmount: '100000',
})

describe('getUtxoChainSpecific sendMaxAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults sendMaxAmount to false', async () => {
    const specific = await getUtxoChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(specific.sendMaxAmount).toBe(false)
    expect(specific.byteFee).toBe('5')
  })

  it('honors an explicit sendMaxAmount: true without changing the default path', async () => {
    const specific = await getUtxoChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
      sendMaxAmount: true,
    })

    expect(specific.sendMaxAmount).toBe(true)
  })
})
