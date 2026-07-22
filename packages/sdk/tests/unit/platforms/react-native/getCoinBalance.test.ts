import { Chain } from '@vultisig/core-chain/Chain'
import { rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCoinBalance } from '../../../../src/platforms/react-native/getCoinBalance'

function mockFetchSequence(bodies: unknown[]): void {
  const fn = vi.fn()
  for (const body of bodies) {
    fn.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status: 200 }))
  }
  vi.stubGlobal('fetch', fn)
}

describe('react-native/getCoinBalance — Ripple routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns spendable XRP after subtracting base + owner reserves', async () => {
    mockFetchSequence([
      {
        result: {
          status: 'success',
          account_data: {
            Account: 'rFunded',
            Balance: '25000000',
            Flags: 0,
            Sequence: 42,
            OwnerCount: 2,
          },
        },
      },
      {
        result: {
          state: {
            validated_ledger: {
              reserve_base: '1000000',
              reserve_inc: '200000',
            },
          },
        },
      },
    ])

    const balance = await getCoinBalance({ chain: Chain.Ripple, address: 'rFunded' })
    expect(balance).toBe(23600000n)
  })

  it('returns 0 for an unfunded XRP account without requiring reserve metadata', async () => {
    mockFetchSequence([
      {
        result: {
          status: 'error',
          error: 'actNotFound',
          error_message: 'Account not found.',
        },
      },
    ])

    const balance = await getCoinBalance({ chain: Chain.Ripple, address: 'rUnfunded' })
    expect(balance).toBe(0n)
  })

  it('returns issued-currency trust-line balances via the RN fetch path', async () => {
    const tokenId = rippleTokenId({
      currency: 'RLUSD',
      issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
    })

    mockFetchSequence([
      {
        result: {
          status: 'success',
          lines: [
            {
              account: 'rOtherIssuer',
              currency: 'USD',
              balance: '4',
            },
          ],
          marker: 'page-2',
        },
      },
      {
        result: {
          status: 'success',
          lines: [
            {
              account: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
              currency: 'RLUSD',
              balance: '12.3456789',
            },
          ],
        },
      },
    ])

    const balance = await getCoinBalance({ chain: Chain.Ripple, address: 'rFunded', id: tokenId })
    expect(balance).toBe(12345678900000000n)
  })
})
