/**
 * Regression test for Blockchair URL construction.
 *
 * Per the documented contract (`packages/sdk/src/chains/utxo/rpc.ts:17`):
 *   "point `apiUrl` at the proxied `${rootApiUrl}/blockchair/{chain}` base"
 *
 * The previous implementation also appended `${chainSlug}` inside the helpers
 * — producing `/blockchair/bitcoin/bitcoin/dashboards/...`. Blockchair returned
 * 404 and every UTXO Blockchair-backed flow broke.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { broadcastUtxoTx, estimateUtxoFee, getUtxoBalance, getUtxos } from '../../../src/chains/utxo/rpc'

const API_URL = 'https://api.vultisig.com/blockchair/bitcoin'
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

const captured: { url: string }[] = []

function mockFetch(...bodies: unknown[]): void {
  let nextBodyIndex = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      captured.push({ url })
      const body = bodies[Math.min(nextBodyIndex, bodies.length - 1)]
      nextBodyIndex += 1
      return new Response(JSON.stringify(body), { status: 200 })
    })
  )
}

describe('Blockchair URL construction does not duplicate chain slug', () => {
  afterEach(() => {
    captured.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('getUtxos hits a URL with exactly one /bitcoin/ segment', async () => {
    mockFetch({ data: { [ADDRESS]: { utxo: [] } } })
    await getUtxos({
      chain: 'Bitcoin',
      address: ADDRESS,
      apiUrl: API_URL,
      apiUrlKind: 'blockchair',
    })
    expect(captured).toHaveLength(1)
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin\//g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/dashboards/address/${ADDRESS}?limit=1000&offset=0`)
  })

  it('getUtxos paginates and keeps only confirmed spendable non-dust Blockchair outputs', async () => {
    mockFetch(
      {
        data: {
          [ADDRESS]: {
            address: { unspent_output_count: 4 },
            utxo: [
              {
                block_id: 10,
                transaction_hash: 'tx-0',
                index: 0,
                value: 10_000,
              },
              {
                block_id: 11,
                transaction_hash: 'dust',
                index: 1,
                value: 546,
                is_spendable: true,
              },
            ],
          },
        },
      },
      {
        data: {
          [ADDRESS]: {
            utxo: [
              {
                block_id: 12,
                transaction_hash: 'locked',
                index: 2,
                value: 10_000,
                is_spendable: false,
              },
              {
                block_id: 0,
                transaction_hash: 'pending',
                index: 3,
                value: 10_000,
                is_spendable: true,
              },
            ],
          },
        },
      }
    )

    const utxos = await getUtxos({
      chain: 'Bitcoin',
      address: ADDRESS,
      apiUrl: API_URL,
      apiUrlKind: 'blockchair',
    })

    expect(captured.map(({ url }) => url)).toEqual([
      `${API_URL}/dashboards/address/${ADDRESS}?limit=1000&offset=0`,
      `${API_URL}/dashboards/address/${ADDRESS}?limit=1000&offset=1000`,
    ])
    expect(utxos).toEqual([{ hash: 'tx-0', index: 0, value: 10_000n }])
  })

  it('getUtxos rejects truncated Blockchair pages', async () => {
    mockFetch(
      {
        data: {
          [ADDRESS]: {
            address: { unspent_output_count: 2 },
            utxo: [{ block_id: 10, transaction_hash: 'tx-0', index: 0, value: 10_000 }],
          },
        },
      },
      {
        data: {
          [ADDRESS]: {
            utxo: [],
          },
        },
      }
    )

    await expect(
      getUtxos({ chain: 'Bitcoin', address: ADDRESS, apiUrl: API_URL, apiUrlKind: 'blockchair' })
    ).rejects.toThrow('Blockchair returned 1 UTXOs')
  })

  it('getUtxoBalance hits a URL with exactly one /bitcoin/ segment', async () => {
    mockFetch({ data: { [ADDRESS]: { address: { balance: 12345 } } } })
    const bal = await getUtxoBalance({
      chain: 'Bitcoin',
      address: ADDRESS,
      apiUrl: API_URL,
      apiUrlKind: 'blockchair',
    })
    expect(bal).toBe(12345n)
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin\//g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/dashboards/address/${ADDRESS}?limit=0`)
  })

  it('estimateUtxoFee hits /stats with no slug duplication', async () => {
    mockFetch({ data: { suggested_transaction_fee_per_byte_sat: 4 } })
    const rate = await estimateUtxoFee({
      chain: 'Bitcoin',
      apiUrl: API_URL,
      apiUrlKind: 'blockchair',
    })
    expect(rate).toBeGreaterThanOrEqual(1)
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin/g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/stats`)
  })

  it('broadcastUtxoTx posts to /push/transaction with no slug duplication', async () => {
    mockFetch({ data: { transaction_hash: 'abc' } })
    const txid = await broadcastUtxoTx({
      chain: 'Bitcoin',
      apiUrl: API_URL,
      apiUrlKind: 'blockchair',
      rawTxHex: 'deadbeef',
    })
    expect(txid).toBe('abc')
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin/g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/push/transaction`)
  })
})

describe('UTXO RPC filtering', () => {
  afterEach(() => {
    captured.length = 0
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps non-dust Electrs outputs unless explicitly unconfirmed', async () => {
    const electrsUrl = 'https://blockstream.info/api'
    mockFetch([
      {
        txid: 'tx-0',
        vout: 0,
        value: 10_000,
        status: { confirmed: true, block_height: 900_000 },
      },
      { txid: 'unknown-status', vout: 1, value: 20_000 },
      {
        txid: 'dust',
        vout: 2,
        value: 546,
        status: { confirmed: true, block_height: 900_001 },
      },
      { txid: 'pending', vout: 3, value: 10_000, status: { confirmed: false } },
    ])

    await expect(getUtxos({ chain: 'Bitcoin', address: ADDRESS, apiUrl: electrsUrl })).resolves.toEqual([
      { hash: 'tx-0', index: 0, value: 10_000n },
      { hash: 'unknown-status', index: 1, value: 20_000n },
    ])
    expect(captured[0]!.url).toBe(`${electrsUrl}/address/${ADDRESS}/utxo`)
  })
})
