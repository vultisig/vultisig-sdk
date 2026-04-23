/**
 * Unit tests for Tron RPC helpers — focused on broadcast error-shape parsing.
 *
 * TronGrid returns three different failure shapes depending on what failed:
 *   1. `{result: false, code, message}` — pre-broadcast validation rejected
 *      the tx (e.g. signature mismatch, expired refblock).
 *   2. `{code: "<class>"}` only — non-success code without a message.
 *   3. `{Error: "<class>"}` (capital `E`, no `result`/`code`) — the gateway
 *      could not even parse the input (e.g. malformed hex).
 *
 * `broadcastTronTx` must throw on all three. The third was missed by the
 * original implementation and surfaced as a silent pass on the runtime
 * harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { broadcastTronTx } from '../../../src/chains/tron/rpc'

type FetchInit = RequestInit | undefined

function stubFetch(payload: unknown, status = 200): void {
  const body = JSON.stringify(payload)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, _init?: FetchInit) => {
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    })
  )
}

describe('tron / broadcastTronTx error parsing', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the gateway response on success (`result: true`)', async () => {
    stubFetch({ result: true, txid: 'aa'.repeat(32), code: 'SUCCESS' })
    const out = await broadcastTronTx('00'.repeat(10), 'https://api.trongrid.io')
    expect(out.result).toBe(true)
    expect(out.txid).toBe('aa'.repeat(32))
  })

  it('throws on `{result: false, message}` (validation rejection)', async () => {
    stubFetch({ result: false, message: 'sigerror', code: 'SIGERROR' })
    await expect(broadcastTronTx('00'.repeat(10), 'https://api.trongrid.io')).rejects.toThrow(
      /tron broadcast failed: sigerror/
    )
  })

  it('throws on non-SUCCESS `{code}` only', async () => {
    stubFetch({ code: 'BANDWITH_ERROR' })
    await expect(broadcastTronTx('00'.repeat(10), 'https://api.trongrid.io')).rejects.toThrow(
      /tron broadcast failed: BANDWITH_ERROR/
    )
  })

  it('throws on TronGrid bare `{Error: "..."}` (capital E, malformed input)', async () => {
    // Real TronGrid response shape for `{transaction: "deadbeef"}`.
    stubFetch({
      Error: 'class org.tron.core.exception.BadItemException : java.lang.NullPointerException',
    })
    await expect(broadcastTronTx('deadbeef', 'https://api.trongrid.io')).rejects.toThrow(
      /tron broadcast failed: class org\.tron\.core\.exception\.BadItemException/
    )
  })

  it('throws on lowercase `{error: "..."}` (mirror gateway variant)', async () => {
    stubFetch({ error: 'invalid signature' })
    await expect(broadcastTronTx('00'.repeat(10), 'https://api.trongrid.io')).rejects.toThrow(
      /tron broadcast failed: invalid signature/
    )
  })
})
