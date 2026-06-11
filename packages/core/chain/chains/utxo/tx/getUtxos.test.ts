import { Chain } from '@vultisig/core-chain/Chain'
import { getDashUtxos } from '@vultisig/core-chain/chains/utxo/client/getDashUtxos'
import { getUtxoAddressInfo } from '@vultisig/core-chain/chains/utxo/client/getUtxoAddressInfo'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getUtxos } from './getUtxos'

vi.mock('@vultisig/core-chain/chains/utxo/client/getDashUtxos', () => ({
  getDashUtxos: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/utxo/client/getUtxoAddressInfo', () => ({
  getUtxoAddressInfo: vi.fn(),
}))

const address = 'bc1qsource'

const makeUtxo = (
  overrides: Partial<{
    block_id: number
    index: number
    is_spendable: boolean
    value: number
  }> = {}
) =>
  ({
    block_id: 100,
    transaction_hash: `tx-${overrides.index ?? 0}`,
    index: 0,
    value: 10_000,
    value_usd: 1,
    recipient: address,
    script_hex: '0014',
    is_from_coinbase: false,
    is_spendable: true,
    ...overrides,
  }) as const

describe('getUtxos', () => {
  beforeEach(() => {
    vi.mocked(getDashUtxos).mockReset()
    vi.mocked(getUtxoAddressInfo).mockReset()
  })

  it('keeps only spendable confirmed non-dust UTXOs', async () => {
    vi.mocked(getUtxoAddressInfo).mockResolvedValue({
      data: {
        [address]: {
          address: { balance: 20_000 },
          utxo: [
            makeUtxo({ index: 0, value: 10_000, is_spendable: undefined }),
            makeUtxo({ index: 1, value: 546 }),
            makeUtxo({ index: 2, is_spendable: false }),
            makeUtxo({ index: 3, block_id: 0 }),
            makeUtxo({ index: 4, block_id: -1 }),
          ],
        },
      },
    })

    await expect(getUtxos({ chain: Chain.Bitcoin, address })).resolves.toEqual([
      {
        hash: 'tx-0',
        amount: 10_000n,
        index: 0,
      },
    ])
  })

  it('keeps Dash on its dedicated RPC path', async () => {
    vi.mocked(getDashUtxos).mockResolvedValue([{ hash: 'dash-tx', amount: 2_000n, index: 1 }])

    await expect(getUtxos({ chain: Chain.Dash, address: 'Xdash' })).resolves.toEqual([
      { hash: 'dash-tx', amount: 2_000n, index: 1 },
    ])
    expect(getUtxoAddressInfo).not.toHaveBeenCalled()
  })
})
