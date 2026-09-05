import { afterEach, describe, expect, it, vi } from 'vitest'

import { getBittensorBalance } from '../../../../src/tools/balance/bittensor'

// Alice's well-known SS58 test address (prefix 42, format-valid; no funds asserted).
const TAO_ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'

// AccountInfo SCALE payload: 16-byte header + free(16, LE) with free = 5_000_000_000n (5 TAO).
const ACCOUNT_INFO_HEX =
  '0x' + '00'.repeat(16) + '00f2052a01000000' + '0000000000000000' + '00'.repeat(16) + '00'.repeat(16)

const rpcResult = (result: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ jsonrpc: '2.0', id: 1, result }),
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getBittensorBalance', () => {
  it('reads the free balance via state_getStorage', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(rpcResult(ACCOUNT_INFO_HEX) as unknown as Response)

    const balance = await getBittensorBalance(TAO_ADDR)

    expect(balance).toBe(5_000_000_000n)
  })

  // Regression for sdk#1343: bittensorFetch previously called
  // `AbortSignal.timeout` directly, which doesn't exist on older RN/Hermes
  // runtimes. Deleting it from the global simulates that environment — the
  // read must still succeed via the Hermes-safe AbortController + setTimeout
  // fallback (both the outer withEndpointTimeout race and the per-request
  // abort controller).
  it('succeeds without AbortSignal.timeout available (Hermes simulation)', async () => {
    const original = globalThis.AbortSignal.timeout
    // @ts-expect-error — simulating a runtime that lacks this static method
    delete globalThis.AbortSignal.timeout
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(rpcResult(ACCOUNT_INFO_HEX) as unknown as Response)
      const balance = await getBittensorBalance(TAO_ADDR)
      expect(balance).toBe(5_000_000_000n)
    } finally {
      globalThis.AbortSignal.timeout = original
    }
  })

  it('returns 0n for a never-funded account (null storage result)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(rpcResult(null) as unknown as Response)
    await expect(getBittensorBalance(TAO_ADDR)).resolves.toBe(0n)
  })
})
