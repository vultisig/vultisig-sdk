import { afterEach, describe, expect, it, vi } from 'vitest'

import { getClaimableUtxos } from './getClaimableUtxos'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const btcAddress = 'bc1qrncuculen6deh35at408fv95ng9kx3ve70gjjx'

const blockchairUtxoResponse = (utxos: Array<{ txid: string; index: number; value: number }>) => ({
  data: {
    [btcAddress]: {
      utxo: utxos.map(({ txid, index, value }) => ({
        block_id: 1,
        transaction_hash: txid,
        index,
        value,
      })),
    },
  },
  context: {},
})

const utxoA = { txid: 'a'.repeat(64), index: 0, value: 681 }
const utxoB = { txid: 'b'.repeat(64), index: 1, value: 1000 }

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const errorResponse = (status: number, body = '') =>
  new Response(body, { status })

describe('getClaimableUtxos', () => {
  it('keeps UTXOs the chain reports as claimable (200 OK)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA, utxoB]))
      }
      // Both /qbtc/v1/utxo/.../... lookups succeed.
      return okResponse({ utxo: { txid: 'irrelevant', vout: 0 } })
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(2)
    expect(result.map(u => u.txid)).toEqual([utxoA.txid, utxoB.txid])
  })

  it('drops UTXOs the chain returns 404 for', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA, utxoB]))
      }
      // utxoA already claimed → 404; utxoB still claimable → 200.
      if (url.endsWith(`/qbtc/v1/utxo/${utxoA.txid}/${utxoA.index}`)) {
        return errorResponse(404, '{"code":2,"message":"UTXO not found"}')
      }
      return okResponse({ utxo: { txid: 'irrelevant', vout: 0 } })
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(1)
    expect(result[0].txid).toBe(utxoB.txid)
  })

  it('propagates non-404 errors from the chain (no silent drop)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA]))
      }
      return errorResponse(503, 'Service Unavailable')
    }) as typeof fetch

    await expect(getClaimableUtxos({ btcAddress })).rejects.toThrow(
      /Failed to verify UTXO/
    )
  })

  it('returns an empty array when Blockchair has no UTXOs', async () => {
    globalThis.fetch = vi.fn(async () =>
      okResponse(blockchairUtxoResponse([]))
    ) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toEqual([])
  })
})
