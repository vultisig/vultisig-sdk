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

import { broadcastTronTx, estimateTrc20Energy } from '../../../src/chains/tron/rpc'

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

describe('tron / estimateTrc20Energy error parsing', () => {
  // Mirrors the broadcastTronTx test surface: same 5 shapes, but on
  // `triggerconstantcontract`. Returning `0` for any of these would let the
  // caller broadcast a TRC-20 transfer with zero energy budget; the network
  // rejects it but only after the user has signed and paid bandwidth.
  beforeEach(() => {
    vi.unstubAllGlobals()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // `from` and `tokenAddress` are passed straight through to the request body,
  // but `to` is bs58check-decoded and must start with the Tron 0x41 version
  // byte. Use TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t (canonical TRC20 USDT
  // contract) as a verified real address — keeps the test free of decoding
  // surprises and lets us focus on response-shape parsing.
  const baseOpts = {
    from: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    to: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    amount: 1_000_000n,
  }

  it('returns energy_required on success', async () => {
    stubFetch({ result: { result: true }, energy_required: 14_000 })
    const out = await estimateTrc20Energy(baseOpts, 'https://api.trongrid.io')
    expect(out).toBe(14_000)
  })

  it('throws on `{result: {result: false, message}}` (existing branch)', async () => {
    stubFetch({ result: { result: false, message: 'BANDWITH_ERROR' } })
    await expect(estimateTrc20Energy(baseOpts, 'https://api.trongrid.io')).rejects.toThrow(
      /triggerconstantcontract failed: BANDWITH_ERROR/
    )
  })

  it('throws on TronGrid bare `{Error: "..."}` (capital E)', async () => {
    // Without this branch, energy_required/energy_used are both undefined and
    // `?? 0` would silently return 0 — the user signs a tx the network drops.
    stubFetch({ Error: 'contract validate error : Invalid contract address' })
    await expect(estimateTrc20Energy(baseOpts, 'https://api.trongrid.io')).rejects.toThrow(
      /triggerconstantcontract failed: contract validate error : Invalid contract address/
    )
  })

  it('throws on lowercase `{error: "..."}` (mirror gateway)', async () => {
    stubFetch({ error: 'rate limited' })
    await expect(estimateTrc20Energy(baseOpts, 'https://api.trongrid.io')).rejects.toThrow(
      /triggerconstantcontract failed: rate limited/
    )
  })
})
