import { afterEach, describe, expect, it, vi } from 'vitest'

import { broadcastClaimTx } from './broadcastClaimTx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('broadcastClaimTx', () => {
  const validInput = {
    txBytesBase64: 'dHhieXRlcw==',
    txHash: 'ABCDEF1234567890',
  }

  it('sends correctly formatted broadcast request', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ tx_response: { code: 0, txhash: 'abc' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch

    await broadcastClaimTx(validInput)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/cosmos/tx/v1beta1/txs'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tx_bytes: validInput.txBytesBase64,
          mode: 'BROADCAST_MODE_SYNC',
        }),
      })
    )
  })

  it('returns claim result with tx hash', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ tx_response: { code: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch

    const result = await broadcastClaimTx(validInput)

    expect(result.txHash).toBe(validInput.txHash)
  })

  it('throws on HTTP error', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('internal error', { status: 500 })
    ) as typeof fetch

    await expect(broadcastClaimTx(validInput)).rejects.toThrow(
      'QBTC claim broadcast failed (500)'
    )
  })

  it('treats "tx already exists in cache" HTTP error as idempotent success', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('tx already exists in cache', { status: 400 })
    ) as typeof fetch

    const result = await broadcastClaimTx(validInput)

    expect(result.txHash).toBe(validInput.txHash)
  })

  it('throws on missing tx_response.code', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ tx_response: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch

    await expect(broadcastClaimTx(validInput)).rejects.toThrow(
      'missing tx_response.code'
    )
  })

  it('throws on non-zero tx response code', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tx_response: { code: 5, raw_log: 'no valid claimable UTXOs found' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as typeof fetch

    await expect(broadcastClaimTx(validInput)).rejects.toThrow(
      'no valid claimable UTXOs found'
    )
  })
})
