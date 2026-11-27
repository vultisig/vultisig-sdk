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

  it('includes unconfirmed non-dust spendable UTXOs when includeUnconfirmed is true', async () => {
    vi.mocked(getUtxoAddressInfo).mockResolvedValue({
      data: {
        [address]: {
          address: { balance: 40_000 },
          utxo: [
            makeUtxo({ index: 0, value: 10_000, block_id: 100 }),
            makeUtxo({ index: 1, value: 546, block_id: -1 }),
            makeUtxo({ index: 2, value: 10_000, block_id: -1, is_spendable: false }),
            makeUtxo({ index: 3, value: 15_000, block_id: 0 }),
            makeUtxo({ index: 4, value: 20_000, block_id: -1 }),
          ],
        },
      },
    })

    await expect(getUtxos({ chain: Chain.Bitcoin, address }, { includeUnconfirmed: true })).resolves.toEqual([
      { hash: 'tx-0', amount: 10_000n, index: 0 },
      { hash: 'tx-3', amount: 15_000n, index: 3 },
      { hash: 'tx-4', amount: 20_000n, index: 4 },
    ])
  })

  it.each([
    [Chain.Litecoin, 2_940, 2_941],
    [Chain.Dogecoin, 1_000_000, 1_000_001],
    [Chain.BitcoinCash, 1_000, 1_001],
    [Chain.Zcash, 1_000, 1_001],
  ])(
    'enforces %s dust floor for unconfirmed UTXOs when includeUnconfirmed is true',
    async (chain, dustValue, spendableValue) => {
      vi.mocked(getUtxoAddressInfo).mockResolvedValue({
        data: {
          [address]: {
            address: { balance: dustValue + spendableValue },
            utxo: [
              makeUtxo({ index: 0, value: dustValue, block_id: -1 }),
              makeUtxo({ index: 1, value: spendableValue, block_id: -1 }),
            ],
          },
        },
      })

      await expect(getUtxos({ chain, address }, { includeUnconfirmed: true })).resolves.toEqual([
        { hash: 'tx-1', amount: BigInt(spendableValue), index: 1 },
      ])
    }
  )

  it('keeps Dash on its dedicated RPC path', async () => {
    vi.mocked(getDashUtxos).mockResolvedValue([{ hash: 'dash-tx', amount: 2_000n, index: 1 }])

    await expect(getUtxos({ chain: Chain.Dash, address: 'Xdash' })).resolves.toEqual([
      { hash: 'dash-tx', amount: 2_000n, index: 1 },
    ])
    await expect(getUtxos({ chain: Chain.Dash, address: 'Xdash' }, { includeUnconfirmed: true })).resolves.toEqual([
      { hash: 'dash-tx', amount: 2_000n, index: 1 },
    ])
    expect(getUtxoAddressInfo).not.toHaveBeenCalled()
  })
})
