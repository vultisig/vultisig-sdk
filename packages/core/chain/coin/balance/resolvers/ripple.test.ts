import { Chain } from '@vultisig/core-chain/Chain'
import { rippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/ripple/client', () => ({
  getRippleClient: async () => ({ request: requestMock }),
}))

import { getRippleCoinBalance } from './ripple'

const ADDRESS = 'rMwNibdiFaEzsTaFCG1NnmAM3Rv3vHUy5L'
const ISSUER = 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De'

// RLUSD is a non-standard code, so on-ledger it is the 160-bit hex form.
const RLUSD_CURRENCY = '524C555344000000000000000000000000000000'

type TrustLine = {
  account: string
  currency: string
  balance: string
}

const accountInfo = (Balance: string, OwnerCount: number) => ({
  result: { account_data: { Balance, OwnerCount } },
})

const serverState = () => ({
  result: {
    state: { validated_ledger: { reserve_base: 1_000_000, reserve_inc: 200_000 } },
  },
})

const accountLines = (lines: TrustLine[], marker?: string) => ({
  result: { lines, ...(marker === undefined ? {} : { marker }) },
})

/** Routes each mocked request by its XRPL command, so call order never matters. */
const mockLedger = ({
  balance = '25000000',
  ownerCount = 0,
  lines = [],
  linePages,
}: {
  balance?: string
  ownerCount?: number
  lines?: TrustLine[]
  linePages?: ReturnType<typeof accountLines>[]
}) => {
  const pages = linePages ? [...linePages] : [accountLines(lines)]

  requestMock.mockImplementation(async ({ command }: { command: string }) => {
    if (command === 'account_info') return accountInfo(balance, ownerCount)
    if (command === 'server_state') return serverState()
    if (command === 'account_lines') return pages.shift() ?? accountLines([])

    throw new Error(`Unexpected command: ${command}`)
  })
}

const nativeCoin = { chain: Chain.Ripple, id: undefined, address: ADDRESS }

const tokenCoin = {
  chain: Chain.Ripple,
  id: rippleTokenId({ currency: 'RLUSD', issuer: ISSUER }),
  address: ADDRESS,
}

describe('getRippleCoinBalance', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  describe('native XRP', () => {
    it('subtracts the base and owner reserves from the total balance', async () => {
      mockLedger({ balance: '25000000', ownerCount: 3 })

      // 25 XRP - (1 XRP base + 3 * 0.2 XRP owner) = 23.4 XRP
      await expect(getRippleCoinBalance(nativeCoin)).resolves.toBe(23_400_000n)
    })

    it('floors at zero when the reserve exceeds the balance', async () => {
      mockLedger({ balance: '500000', ownerCount: 0 })

      await expect(getRippleCoinBalance(nativeCoin)).resolves.toBe(0n)
    })
  })

  describe('issued currency', () => {
    it('reads the trust-line balance for the coin id, not the XRP balance', async () => {
      // The regression this guards: the resolver used to ignore `id` entirely and
      // return spendable XRP for every coin, so a token row showed the XRP balance.
      mockLedger({
        balance: '25000000',
        lines: [{ account: ISSUER, currency: RLUSD_CURRENCY, balance: '12.5' }],
      })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(12_500_000_000_000_000n)
    })

    it('keeps full precision for a dust balance', async () => {
      mockLedger({
        lines: [{ account: ISSUER, currency: RLUSD_CURRENCY, balance: '0.00204230364' }],
      })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(2_042_303_640_000n)
    })

    it('reports zero when the account holds no line for the token', async () => {
      mockLedger({ lines: [] })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(0n)
    })

    it('does not match a line from a different issuer of the same currency', async () => {
      mockLedger({
        lines: [{ account: 'rSomeOtherIssuer', currency: RLUSD_CURRENCY, balance: '99' }],
      })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(0n)
    })

    it('reports zero for a negative line rather than a negative asset', async () => {
      // A negative balance means this account issued the token and owes the peer.
      mockLedger({
        lines: [{ account: ISSUER, currency: RLUSD_CURRENCY, balance: '-42' }],
      })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(0n)
    })

    it('follows account_lines pagination instead of truncating at the first page', async () => {
      mockLedger({
        linePages: [
          accountLines([{ account: 'rOther', currency: 'USD', balance: '1' }], 'next-page'),
          accountLines([{ account: ISSUER, currency: RLUSD_CURRENCY, balance: '7' }]),
        ],
      })

      await expect(getRippleCoinBalance(tokenCoin)).resolves.toBe(7_000_000_000_000_000n)
    })
  })
})
