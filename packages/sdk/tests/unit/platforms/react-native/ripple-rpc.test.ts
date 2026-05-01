/**
 * Regression test for the `actNotFound` handling in getXrpAccountInfo.
 *
 * XRPL's `account_info` RPC returns `status: "error", error: "actNotFound"`
 * for unfunded addresses — a normal / expected case. The previous
 * implementation threw inside `rippleCall` on any `status === "error"`, so
 * the `funded: false` branch in `getXrpAccountInfo` was unreachable and
 * `getXrpBalance` exploded instead of returning `"0"`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getXrpAccountInfo, getXrpBalance } from '../../../../src/platforms/react-native/chains/ripple/rpc'

const RPC_URL = 'https://xrplcluster.com'
const UNFUNDED = 'rUnfundedAccount1234567890abcdef'
const FUNDED = 'rFundedAccount1234567890abcdef'

function mockFetchOnce(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  )
}

describe('ripple/rpc — account_info error handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns funded:false for actNotFound instead of throwing', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'actNotFound',
        error_message: 'Account not found.',
      },
    })

    const info = await getXrpAccountInfo(UNFUNDED, RPC_URL)
    expect(info).toEqual({
      address: UNFUNDED,
      sequence: 0,
      balanceDrops: '0',
      flags: 0,
      funded: false,
    })
  })

  it('getXrpBalance returns "0" for unfunded account', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'actNotFound',
        error_message: 'Account not found.',
      },
    })

    const bal = await getXrpBalance(UNFUNDED, RPC_URL)
    expect(bal).toBe('0')
  })

  it('returns full info with funded:true for a funded account', async () => {
    mockFetchOnce({
      result: {
        status: 'success',
        account_data: {
          Account: FUNDED,
          Balance: '25000000',
          Flags: 0,
          Sequence: 42,
        },
      },
    })

    const info = await getXrpAccountInfo(FUNDED, RPC_URL)
    expect(info).toEqual({
      address: FUNDED,
      sequence: 42,
      balanceDrops: '25000000',
      flags: 0,
      funded: true,
    })
  })

  it('still throws on genuinely unexpected protocol errors (e.g. rpcInvalidParams)', async () => {
    mockFetchOnce({
      result: {
        status: 'error',
        error: 'invalidParams',
        error_message: 'missing field account',
      },
    })

    await expect(getXrpAccountInfo(FUNDED, RPC_URL)).rejects.toThrow(/invalidParams/)
  })
})
