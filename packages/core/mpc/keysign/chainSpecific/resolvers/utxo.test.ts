import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/utxo/fee/byteFee', () => ({
  getUtxoByteFee: vi.fn().mockResolvedValue(12n),
}))

import { getUtxoChainSpecific } from './utxo'

const keysignPayload = {
  coin: {
    chain: Chain.Bitcoin,
    address: 'bc1qsender',
    ticker: 'BTC',
    decimals: 8,
    contractAddress: '',
  },
} as never

describe('getUtxoChainSpecific', () => {
  it('carries explicit max intent into the WalletCore signing plan', async () => {
    await expect(
      getUtxoChainSpecific({ keysignPayload, walletCore: {} as never, sendMaxAmount: true })
    ).resolves.toMatchObject({ sendMaxAmount: true, byteFee: '12' })
  })

  it('defaults ordinary sends to a non-max plan', async () => {
    await expect(getUtxoChainSpecific({ keysignPayload, walletCore: {} as never })).resolves.toMatchObject({
      sendMaxAmount: false,
      byteFee: '12',
    })
  })
})
