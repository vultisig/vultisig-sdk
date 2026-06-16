import { Chain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getUtxoAddressInfo } from './getUtxoAddressInfo'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

describe('getUtxoAddressInfo', () => {
  beforeEach(() => {
    vi.mocked(queryUrl).mockReset()
  })

  it('requests all Blockchair UTXO pages', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          bc1qsource: {
            address: { balance: 3_000, unspent_output_count: 3 },
            utxo: [
              {
                block_id: 100,
                transaction_hash: 'tx-0',
                index: 0,
                value: 1_000,
                value_usd: 1,
                recipient: 'bc1qsource',
                script_hex: '0014',
                is_from_coinbase: false,
                is_spendable: true,
              },
              {
                block_id: 101,
                transaction_hash: 'tx-1',
                index: 1,
                value: 1_000,
                value_usd: 1,
                recipient: 'bc1qsource',
                script_hex: '0014',
                is_from_coinbase: false,
                is_spendable: true,
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          bc1qsource: {
            utxo: [
              {
                block_id: 102,
                transaction_hash: 'tx-2',
                index: 2,
                value: 1_000,
                value_usd: 1,
                recipient: 'bc1qsource',
                script_hex: '0014',
                is_from_coinbase: false,
                is_spendable: true,
              },
            ],
          },
        },
      })

    const result = await getUtxoAddressInfo({
      chain: Chain.Bitcoin,
      address: 'bc1qsource',
    })

    expect(queryUrl).toHaveBeenNthCalledWith(
      1,
      `${rootApiUrl}/blockchair/bitcoin/dashboards/address/bc1qsource?limit=1000&offset=0`
    )
    expect(queryUrl).toHaveBeenNthCalledWith(
      2,
      `${rootApiUrl}/blockchair/bitcoin/dashboards/address/bc1qsource?limit=1000&offset=1000`
    )
    expect(result.data.bc1qsource?.utxo.map(({ transaction_hash }) => transaction_hash)).toEqual([
      'tx-0',
      'tx-1',
      'tx-2',
    ])
  })

  it('rejects truncated Blockchair UTXO pages', async () => {
    vi.mocked(queryUrl)
      .mockResolvedValueOnce({
        data: {
          bc1qsource: {
            address: { balance: 2_000, unspent_output_count: 2 },
            utxo: [
              {
                block_id: 100,
                transaction_hash: 'tx-0',
                index: 0,
                value: 1_000,
                value_usd: 1,
                recipient: 'bc1qsource',
                script_hex: '0014',
                is_from_coinbase: false,
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          bc1qsource: {
            utxo: [],
          },
        },
      })

    await expect(getUtxoAddressInfo({ chain: Chain.Bitcoin, address: 'bc1qsource' })).rejects.toThrow(
      'Blockchair returned 1 UTXOs'
    )
  })
})
