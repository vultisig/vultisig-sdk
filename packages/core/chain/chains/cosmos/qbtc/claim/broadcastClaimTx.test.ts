import { afterEach, describe, expect, it, vi } from 'vitest'

import { broadcastClaimTx, waitForClaimTxResult } from './broadcastClaimTx'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const txBytesBase64 = 'dHhieXRlcw=='
const txHash = 'ABCDEF1234567890'

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

const errorResponse = (status: number, body = '') =>
  new Response(body, { status })

const claimEvent = (attrs: Record<string, string>) => ({
  type: 'claim_with_proof',
  attributes: Object.entries(attrs).map(([key, value]) => ({ key, value })),
})

const broadcastSuccess = () => okJson({ tx_response: { code: 0, txhash: txHash } })

const includedSuccess = (attrs: Record<string, string> = {}) =>
  okJson({ tx_response: { code: 0, events: [claimEvent(attrs)] } })

const fastPolling = {
  inclusionTimeoutMs: 5_000,
  inclusionPollIntervalMs: 5,
}

describe('broadcastClaimTx', () => {
  it('sends correctly formatted broadcast request', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broadcastSuccess())
      .mockResolvedValueOnce(includedSuccess())

    await broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/cosmos/tx/v1beta1/txs'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          tx_bytes: txBytesBase64,
          mode: 'BROADCAST_MODE_SYNC',
        }),
      })
    )
  })

  it('returns real values parsed from the claim_with_proof event', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broadcastSuccess())
      .mockResolvedValueOnce(
        includedSuccess({
          total_amount: '681',
          utxos_claimed: '1',
          utxos_skipped: '0',
        })
      )

    const result = await broadcastClaimTx({
      txBytesBase64,
      txHash,
      ...fastPolling,
    })

    expect(result).toEqual({
      totalAmountClaimed: 681n,
      utxosClaimed: 1,
      utxosSkipped: 0,
      txHash,
    })
  })

  it('retries on 404 until the tx is included', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broadcastSuccess())
      .mockResolvedValueOnce(errorResponse(404, 'tx not found'))
      .mockResolvedValueOnce(errorResponse(404, 'tx not found'))
      .mockResolvedValueOnce(
        includedSuccess({
          total_amount: '500',
          utxos_claimed: '2',
          utxos_skipped: '1',
        })
      )
    globalThis.fetch = fetchMock

    const result = await broadcastClaimTx({
      txBytesBase64,
      txHash,
      ...fastPolling,
    })

    expect(result.totalAmountClaimed).toBe(500n)
    expect(result.utxosClaimed).toBe(2)
    expect(result.utxosSkipped).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('throws if DeliverTx code is non-zero after inclusion', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broadcastSuccess())
      .mockResolvedValueOnce(
        okJson({ tx_response: { code: 5, raw_log: 'address mismatch' } })
      )

    await expect(
      broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })
    ).rejects.toThrow(/QBTC claim tx error: address mismatch/)
  })

  it('propagates non-404 infra errors from the inclusion query', async () => {
    globalThis.fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(broadcastSuccess())
      .mockResolvedValueOnce(errorResponse(503, 'upstream down'))

    await expect(
      broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })
    ).rejects.toThrow(/inclusion query failed \(503\)/)
  })

  it('throws if the tx never lands within the timeout', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/cosmos/tx/v1beta1/txs')) return broadcastSuccess()
      return errorResponse(404, 'tx not found')
    }) as typeof fetch

    await expect(
      broadcastClaimTx({
        txBytesBase64,
        txHash,
        inclusionTimeoutMs: 30,
        inclusionPollIntervalMs: 5,
      })
    ).rejects.toThrow(/not included within 30ms/)
  })

  it('throws on broadcast HTTP error', async () => {
    globalThis.fetch = vi.fn(async () =>
      errorResponse(500, 'internal error')
    ) as typeof fetch

    await expect(
      broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })
    ).rejects.toThrow('QBTC claim broadcast failed (500)')
  })

  it('treats "tx already exists in cache" HTTP error as idempotent success', async () => {
    globalThis.fetch = vi.fn(async () =>
      errorResponse(400, 'tx already exists in cache')
    ) as typeof fetch

    const result = await broadcastClaimTx({
      txBytesBase64,
      txHash,
      ...fastPolling,
    })

    expect(result).toEqual({
      totalAmountClaimed: 0n,
      utxosClaimed: 0,
      utxosSkipped: 0,
      txHash,
    })
  })

  it('throws on missing tx_response.code', async () => {
    globalThis.fetch = vi.fn(async () =>
      okJson({ tx_response: {} })
    ) as typeof fetch

    await expect(
      broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })
    ).rejects.toThrow('missing tx_response.code')
  })

  it('throws on non-zero CheckTx code', async () => {
    globalThis.fetch = vi.fn(async () =>
      okJson({
        tx_response: { code: 5, raw_log: 'no valid claimable UTXOs found' },
      })
    ) as typeof fetch

    await expect(
      broadcastClaimTx({ txBytesBase64, txHash, ...fastPolling })
    ).rejects.toThrow('no valid claimable UTXOs found')
  })
})

describe('waitForClaimTxResult', () => {
  it('parses claim_with_proof event for an already-broadcast tx', async () => {
    globalThis.fetch = vi.fn(async () =>
      includedSuccess({
        total_amount: '12345',
        utxos_claimed: '3',
        utxos_skipped: '1',
      })
    ) as typeof fetch

    const result = await waitForClaimTxResult({ txHash, ...fastPolling })

    expect(result).toEqual({
      totalAmountClaimed: 12345n,
      utxosClaimed: 3,
      utxosSkipped: 1,
      txHash,
    })
  })

  it('retries on 404 until included', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(errorResponse(404, 'tx not found'))
      .mockResolvedValueOnce(includedSuccess({ total_amount: '7' }))
    globalThis.fetch = fetchMock

    const result = await waitForClaimTxResult({ txHash, ...fastPolling })

    expect(result.totalAmountClaimed).toBe(7n)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws if the chain returned a non-zero code', async () => {
    globalThis.fetch = vi.fn(async () =>
      okJson({ tx_response: { code: 5, raw_log: 'address mismatch' } })
    ) as typeof fetch

    await expect(
      waitForClaimTxResult({ txHash, ...fastPolling })
    ).rejects.toThrow(/QBTC claim tx error: address mismatch/)
  })
})
