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

const qbtcUtxoBody = ({
  txid,
  vout,
  amount,
  entitledAmount,
}: {
  txid: string
  vout: number
  amount: string
  entitledAmount: string
}) => ({
  utxo: {
    txid,
    vout,
    amount,
    entitled_amount: entitledAmount,
  },
})

const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const errorResponse = (status: number, body = '') => new Response(body, { status })

describe('getClaimableUtxos', () => {
  it('keeps UTXOs whose entitled_amount is positive', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA, utxoB]))
      }
      if (url.endsWith(`/qbtc/v1/utxo/${utxoA.txid}/${utxoA.index}`)) {
        return okResponse(
          qbtcUtxoBody({
            txid: utxoA.txid,
            vout: utxoA.index,
            amount: String(utxoA.value),
            entitledAmount: String(utxoA.value),
          })
        )
      }
      return okResponse(
        qbtcUtxoBody({
          txid: utxoB.txid,
          vout: utxoB.index,
          amount: String(utxoB.value),
          entitledAmount: String(utxoB.value),
        })
      )
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(2)
    expect(result.map(u => u.txid)).toEqual([utxoA.txid, utxoB.txid])
    expect(result.map(u => u.amount)).toEqual([utxoA.value, utxoB.value])
  })

  it('drops UTXOs whose entitled_amount is 0 (already paid out)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA, utxoB]))
      }
      if (url.endsWith(`/qbtc/v1/utxo/${utxoA.txid}/${utxoA.index}`)) {
        // utxoA has been fully paid out — chain returns 200 with 0 entitled.
        return okResponse(
          qbtcUtxoBody({
            txid: utxoA.txid,
            vout: utxoA.index,
            amount: String(utxoA.value),
            entitledAmount: '0',
          })
        )
      }
      return okResponse(
        qbtcUtxoBody({
          txid: utxoB.txid,
          vout: utxoB.index,
          amount: String(utxoB.value),
          entitledAmount: String(utxoB.value),
        })
      )
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(1)
    expect(result[0].txid).toBe(utxoB.txid)
  })

  it('drops UTXOs the chain returns 404 for', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA, utxoB]))
      }
      if (url.endsWith(`/qbtc/v1/utxo/${utxoA.txid}/${utxoA.index}`)) {
        return errorResponse(404, '{"code":2,"message":"UTXO not found"}')
      }
      return okResponse(
        qbtcUtxoBody({
          txid: utxoB.txid,
          vout: utxoB.index,
          amount: String(utxoB.value),
          entitledAmount: String(utxoB.value),
        })
      )
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(1)
    expect(result[0].txid).toBe(utxoB.txid)
  })

  it('uses the chain-reported entitled_amount, not the Blockchair value', async () => {
    // Blockchair says 1000, but the chain has already paid out 400 of it,
    // leaving 600 still claimable. The picker should show 600, not 1000.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoB]))
      }
      return okResponse(
        qbtcUtxoBody({
          txid: utxoB.txid,
          vout: utxoB.index,
          amount: String(utxoB.value),
          entitledAmount: '600',
        })
      )
    }) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toHaveLength(1)
    expect(result[0].amount).toBe(600)
  })

  it('propagates non-404 errors from the chain (no silent drop)', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('blockchair') || url.includes('utxo/dashboards')) {
        return okResponse(blockchairUtxoResponse([utxoA]))
      }
      return errorResponse(503, 'Service Unavailable')
    }) as typeof fetch

    await expect(getClaimableUtxos({ btcAddress })).rejects.toThrow(/Failed to verify UTXO/)
  })

  it('returns an empty array when Blockchair has no UTXOs', async () => {
    globalThis.fetch = vi.fn(async () => okResponse(blockchairUtxoResponse([]))) as typeof fetch

    const result = await getClaimableUtxos({ btcAddress })

    expect(result).toEqual([])
  })
})
