import { Chain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { describe, expect, it, vi } from 'vitest'

import { getOneInchSwapQuote } from './getOneInchSwapQuote'

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: vi.fn(),
}))

const account = { chain: Chain.Ethereum, address: '0xsender' }

describe('getOneInchSwapQuote — AGG-02 router allowlist', () => {
  it('REJECTS a response whose tx.to is not the real 1inch router (spoofed/compromised aggregator)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: '0x000000000000000000000000000000deadbeef', // NOT 1inch's router
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    await expect(
      getOneInchSwapQuote({
        account,
        fromCoinId: '0xsrc',
        toCoinId: '0xdst',
        amount: 1_000_000n,
      })
    ).rejects.toThrow(/unrecognized router address/)
  })

  it('accepts a response whose tx.to is the real 1inch V6 router', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: '0x111111125421ca6dc452d289314280a0f8842a65', // real 1inch V6 router
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    const quote = await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      amount: 1_000_000n,
    })

    expect('evm' in quote.tx ? quote.tx.evm.to : undefined).toBe('0x111111125421ca6dc452d289314280a0f8842a65')
  })

  // codex review (PR #1079): 1inch's router differs on zkSync Era — confirmed live. The
  // allowlist is chain-scoped; prove the real function threads account.chain through
  // correctly rather than just trusting the allowlist unit tests in isolation.
  describe('zkSync Era — a genuinely different router (chain-scoped allowlist)', () => {
    const zksyncAccount = { chain: Chain.Zksync, address: '0xsender' }
    const ZKSYNC_ROUTER = '0x6fd4383cb451173d5f9304f041c7bcbf27d561ff'
    const STANDARD_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'

    it('accepts the zkSync-specific router when account.chain is Zksync', async () => {
      vi.mocked(queryUrl).mockResolvedValueOnce({
        dstAmount: '1000000',
        tx: { from: '0xsender', to: ZKSYNC_ROUTER, data: '0xswap', value: '0', gasPrice: '1000000000', gas: 210000 },
      })

      const quote = await getOneInchSwapQuote({
        account: zksyncAccount,
        fromCoinId: '0xsrc',
        toCoinId: '0xdst',
        amount: 1_000_000n,
      })

      expect('evm' in quote.tx ? quote.tx.evm.to : undefined).toBe(ZKSYNC_ROUTER)
    })

    it('REJECTS the standard V6 router when account.chain is Zksync (the exact bug this fixes)', async () => {
      vi.mocked(queryUrl).mockResolvedValueOnce({
        dstAmount: '1000000',
        tx: {
          from: '0xsender',
          to: STANDARD_V6_ROUTER,
          data: '0xswap',
          value: '0',
          gasPrice: '1000000000',
          gas: 210000,
        },
      })

      await expect(
        getOneInchSwapQuote({ account: zksyncAccount, fromCoinId: '0xsrc', toCoinId: '0xdst', amount: 1_000_000n })
      ).rejects.toThrow(/unrecognized router address/)
    })
  })
})

describe('getOneInchSwapQuote — native asset sentinel (EIP-7528)', () => {
  const mockResponse = {
    dstAmount: '1000000',
    tx: {
      from: '0xsender',
      to: '0x111111125421ca6dc452d289314280a0f8842a65',
      data: '0xswap',
      value: '0',
      gasPrice: '1000000000',
      gas: 210000,
    },
  }

  it('maps a native destination (toCoinId undefined) to the 0xEeee sentinel, not a ticker string', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(mockResponse)

    await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: undefined,
      amount: 1_000_000n,
    })

    const calledUrl = vi.mocked(queryUrl).mock.calls.at(-1)![0] as string
    expect(calledUrl).toContain('dst=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    expect(calledUrl).not.toContain('dst=ETH')
  })

  it('maps a native source (fromCoinId undefined) to the 0xEeee sentinel, not a ticker string', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(mockResponse)

    await getOneInchSwapQuote({
      account,
      fromCoinId: undefined,
      toCoinId: '0xdst',
      amount: 1_000_000n,
    })

    const calledUrl = vi.mocked(queryUrl).mock.calls.at(-1)![0] as string
    expect(calledUrl).toContain('src=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')
    expect(calledUrl).not.toContain('src=ETH')
  })

  it('leaves an ERC-20 destination untouched (non-native dst is not remapped)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce(mockResponse)

    await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      amount: 1_000_000n,
    })

    const calledUrl = vi.mocked(queryUrl).mock.calls.at(-1)![0] as string
    expect(calledUrl).toContain('dst=0xdst')
    expect(calledUrl).toContain('src=0xsrc')
  })
})

describe('getOneInchSwapQuote — affiliateFee display (AGG-05)', () => {
  it('populates affiliateFee grossed up from the post-fee dstAmount, matching the Kyber convention', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '10000000',
      tx: {
        from: '0xsender',
        to: '0x111111125421ca6dc452d289314280a0f8842a65',
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    const quote = await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      to: { chain: Chain.Ethereum, address: '0xsender', id: '0xdst', decimals: 6, ticker: 'DST' },
      amount: 1_000_000n,
      affiliateBps: 50,
    })

    expect('evm' in quote.tx ? quote.tx.evm.affiliateFee : undefined).toEqual({
      chain: Chain.Ethereum,
      id: '0xdst',
      decimals: 6,
      amount: 50_251n,
    })
  })

  it('leaves affiliateFee undefined when no affiliateBps is set', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '10000000',
      tx: {
        from: '0xsender',
        to: '0x111111125421ca6dc452d289314280a0f8842a65',
        data: '0xswap',
        value: '0',
        gasPrice: '1000000000',
        gas: 210000,
      },
    })

    const quote = await getOneInchSwapQuote({
      account,
      fromCoinId: '0xsrc',
      toCoinId: '0xdst',
      to: { chain: Chain.Ethereum, address: '0xsender', id: '0xdst', decimals: 6, ticker: 'DST' },
      amount: 1_000_000n,
    })

    expect('evm' in quote.tx ? quote.tx.evm.affiliateFee : undefined).toBeUndefined()
  })
})

describe('getOneInchSwapQuote — token-source tx.value guard (P3 hardening)', () => {
  const REAL_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'

  it('REJECTS a non-zero tx.value for a token-source swap (native-value injection)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: REAL_ROUTER,
        data: '0xswap',
        value: '1000000000000000000',
        gasPrice: '1',
        gas: 210000,
      },
    })

    await expect(
      getOneInchSwapQuote({ account, fromCoinId: '0xsrc', toCoinId: '0xdst', amount: 1_000_000n })
    ).rejects.toThrow(/non-zero tx\.value .* token-source swap/)
  })

  it('accepts a non-zero tx.value for a NATIVE-source swap (value is the sell amount)', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: {
        from: '0xsender',
        to: REAL_ROUTER,
        data: '0xswap',
        value: '1000000000000000000',
        gasPrice: '1',
        gas: 210000,
      },
    })

    const quote = await getOneInchSwapQuote({ account, fromCoinId: undefined, toCoinId: '0xdst', amount: 1_000_000n })
    expect('evm' in quote.tx ? quote.tx.evm.value : undefined).toBe('1000000000000000000')
  })

  it('accepts a zero tx.value for a token-source swap', async () => {
    vi.mocked(queryUrl).mockResolvedValueOnce({
      dstAmount: '1000000',
      tx: { from: '0xsender', to: REAL_ROUTER, data: '0xswap', value: '0', gasPrice: '1', gas: 210000 },
    })

    const quote = await getOneInchSwapQuote({ account, fromCoinId: '0xsrc', toCoinId: '0xdst', amount: 1_000_000n })
    expect('evm' in quote.tx ? quote.tx.evm.value : undefined).toBe('0')
  })
})
