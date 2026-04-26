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

import {
  broadcastUtxoTx,
  estimateUtxoFee,
  getUtxoBalance,
  getUtxos,
} from '../../../src/chains/utxo/rpc'

const API_URL = 'https://api.vultisig.com/blockchair/bitcoin'
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

const captured: { url: string }[] = []

function mockFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      captured.push({ url })
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
    await getUtxos({ chain: 'Bitcoin', address: ADDRESS, apiUrl: API_URL, apiUrlKind: 'blockchair' })
    expect(captured).toHaveLength(1)
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin\//g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/dashboards/address/${ADDRESS}?limit=100`)
  })

  it('getUtxoBalance hits a URL with exactly one /bitcoin/ segment', async () => {
    mockFetch({ data: { [ADDRESS]: { address: { balance: 12345 } } } })
    const bal = await getUtxoBalance({ chain: 'Bitcoin', address: ADDRESS, apiUrl: API_URL, apiUrlKind: 'blockchair' })
    expect(bal).toBe(12345n)
    const url = captured[0]!.url
    expect(url.match(/\/bitcoin\//g) ?? []).toHaveLength(1)
    expect(url).toBe(`${API_URL}/dashboards/address/${ADDRESS}?limit=0`)
  })

  it('estimateUtxoFee hits /stats with no slug duplication', async () => {
    mockFetch({ data: { suggested_transaction_fee_per_byte_sat: 4 } })
    const rate = await estimateUtxoFee({ chain: 'Bitcoin', apiUrl: API_URL, apiUrlKind: 'blockchair' })
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
