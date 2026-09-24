import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getNativeSwapMinAmountIn = vi.hoisted(() => vi.fn().mockResolvedValue(null))

vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn,
}))

import { VaultBase } from '@/vault/VaultBase'

const btc: AccountCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1qsource',
  ticker: 'BTC',
  decimals: 8,
}

const eth: AccountCoin = {
  chain: Chain.Ethereum,
  address: '0x1234567890abcdef1234567890abcdef12345678',
  ticker: 'ETH',
  decimals: 18,
}

const usdc: AccountCoin = {
  chain: Chain.Ethereum,
  address: eth.address,
  ticker: 'USDC',
  decimals: 6,
  id: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
}

const nativeQuote = ({
  from,
  to,
  outbound = '9022',
  recommendedMinimum = '6316',
}: {
  from: AccountCoin
  to: AccountCoin
  outbound?: string
  recommendedMinimum?: string
}) => ({
  quote: {
    quote: {
      native: {
        swapChain: Chain.THORChain,
        expected_amount_out: '100000000',
        expiry: Math.floor(Date.now() / 1000) + 600,
        fees: {
          affiliate: '0',
          asset: `${to.ticker}.${to.ticker}`,
          outbound,
          total: outbound,
        },
        inbound_address: from.chain === Chain.Bitcoin ? 'bc1qinbound' : '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        memo: `=:${to.ticker}.${to.ticker}:${to.address}`,
        notes: '',
        outbound_delay_blocks: 0,
        outbound_delay_seconds: 0,
        recommended_min_amount_in: recommendedMinimum,
        warning: '',
      },
    },
    discounts: [],
    requestedAmount: 1n,
    expiresAt: Date.now() + 60_000,
    safetyFingerprint: 'fingerprint',
  },
  estimatedOutput: 100_000_000n,
  provider: 'thorchain',
  expiresAt: Date.now() + 60_000,
  requiresApproval: false,
  fees: { network: 0n, total: 0n },
  warnings: [] as string[],
  fromCoin: {
    chain: from.chain,
    ticker: from.ticker,
    decimals: from.decimals,
    tokenId: from.id,
  },
  toCoin: {
    chain: to.chain,
    ticker: to.ticker,
    decimals: to.decimals,
    tokenId: to.id,
  },
})

const transferQuote = ({ from, to }: { from: AccountCoin; to: AccountCoin }) => ({
  quote: {
    quote: {
      general: {
        dstAmount: '100000000000000000',
        provider: 'swapkit' as const,
        tx: {
          transfer: { to: 'bc1qdeposit', amount: 500_000n, memo: 'route-memo' },
        },
      },
    },
    discounts: [],
    requestedAmount: 1n,
    expiresAt: Date.now() + 60_000,
    safetyFingerprint: 'fingerprint',
  },
  estimatedOutput: 100_000_000_000_000_000n,
  provider: 'swapkit',
  expiresAt: Date.now() + 60_000,
  requiresApproval: false,
  fees: { network: 0n, total: 0n },
  warnings: [] as string[],
  fromCoin: {
    chain: from.chain,
    ticker: from.ticker,
    decimals: from.decimals,
    tokenId: from.id,
  },
  toCoin: {
    chain: to.chain,
    ticker: to.ticker,
    decimals: to.decimals,
    tokenId: to.id,
  },
})

function makeVault({ quote, balance, fee }: { quote: unknown; balance: bigint; fee: bigint | Error }) {
  const estimateSendFee = fee instanceof Error ? vi.fn().mockRejectedValue(fee) : vi.fn().mockResolvedValue(fee)
  const vault = Object.create(VaultBase.prototype) as VaultBase
  Object.assign(vault as object, {
    swapService: { getQuote: vi.fn().mockResolvedValue(quote) },
    balanceService: {
      getBalance: vi.fn().mockResolvedValue({ amount: balance.toString() }),
    },
    transactionBuilder: { estimateSendFee },
    address: vi.fn(async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address)),
  })
  return { vault, estimateSendFee }
}

describe('VaultBase.getSwapQuote fee-aware maximums', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getNativeSwapMinAmountIn.mockResolvedValue(null)
  })

  it('reserves the estimated Bitcoin fee instead of the ETH-denominated native outbound fee', async () => {
    const balance = 12_621n
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault, estimateSendFee } = makeVault({ quote, balance, fee: 500n })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
    })

    expect(result.fees.network).not.toBe(9_022n)
    expect(result.maxSwapable).toBe(12_121n)
    expect(estimateSendFee).toHaveBeenCalledWith({
      coin: btc,
      receiver: 'bc1qinbound',
      amount: balance,
      memo: quote.quote.quote.native.memo,
    })
  })

  it('reserves the estimated Ethereum fee instead of the BTC-denominated native outbound fee', async () => {
    const balance = 1_000_000_000_000_000_000n
    const quote = nativeQuote({
      from: eth,
      to: btc,
      outbound: '9022',
      recommendedMinimum: '0',
    })
    const { vault } = makeVault({ quote, balance, fee: 21_000_000_000_000n })

    const result = await vault.getSwapQuote({
      fromCoin: eth,
      toCoin: btc,
      amount: '1',
    })

    expect(result.maxSwapable).toBe(999_979_000_000_000_000n)
    expect(result.maxSwapable).not.toBe(balance - 9_022n)
  })

  it('fails closed when the source-chain fee estimator throws', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: new Error('fee unavailable'),
    })

    await expect(vault.getSwapQuote({ fromCoin: btc, toCoin: eth, amount: '0.00012621' })).resolves.toMatchObject({
      maxSwapable: 0n,
    })
  })

  it('warns when a native swap amount is below the provider recommended minimum', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 500n })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00003599',
    })

    expect(result.warnings).toEqual([
      "Amount 0.00003599 BTC is below THORChain's recommended minimum of 0.00006316 BTC; the swap may fail or be refunded net of fees.",
    ])
  })

  it('does not warn when a native swap amount meets the provider recommended minimum', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 500n })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00006316',
    })

    expect(result.warnings).toEqual([])
  })

  it('uses the native minimum helper when the provider omits a positive recommendation', async () => {
    getNativeSwapMinAmountIn.mockResolvedValue({
      swapChain: Chain.THORChain,
      minAmountInBaseUnits: 6_316n,
      minAmountInHuman: '0.00006316',
      outboundFeeBaseUnit: '9022',
      binding: 'outbound',
    })
    const quote = nativeQuote({ from: btc, to: eth, recommendedMinimum: '0' })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 500n })

    const result = await vault.getSwapQuote({ fromCoin: btc, toCoin: eth, amount: '0.00003599' })

    expect(getNativeSwapMinAmountIn).toHaveBeenCalledWith({
      from: btc,
      to: eth,
      swapChain: Chain.THORChain,
    })
    expect(result.warnings[0]).toContain('0.00003599 BTC')
    expect(result.warnings[0]).toContain('0.00006316 BTC')
  })

  it('computes a fee-aware maximum for native transfer routes when estimation succeeds', async () => {
    const quote = transferQuote({ from: btc, to: eth })
    const { vault, estimateSendFee } = makeVault({
      quote,
      balance: 12_621n,
      fee: 500n,
    })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
    })

    expect(result.maxSwapable).toBe(12_121n)
    expect(estimateSendFee).toHaveBeenCalledWith({
      coin: btc,
      receiver: 'bc1qdeposit',
      amount: 12_621n,
      memo: 'route-memo',
    })
  })

  it('keeps a native transfer route maximum at zero when estimation fails', async () => {
    const quote = transferQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: new Error('fee unavailable'),
    })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
    })

    expect(result.maxSwapable).toBe(0n)
  })

  it('leaves the full token balance swappable without estimating a source fee', async () => {
    const balance = 25_000_000n
    const quote = nativeQuote({ from: usdc, to: btc, recommendedMinimum: '0' })
    const { vault, estimateSendFee } = makeVault({
      quote,
      balance,
      fee: 21_000_000_000_000n,
    })

    const result = await vault.getSwapQuote({
      fromCoin: usdc,
      toCoin: btc,
      amount: '25',
    })

    expect(result.maxSwapable).toBe(balance)
    expect(estimateSendFee).not.toHaveBeenCalled()
  })
})

describe('VaultBase.swap max fee-estimation failures', () => {
  it('throws the existing fee-aware max error when source-fee estimation fails', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: new Error('fee unavailable'),
    })
    Object.assign(vault as object, {
      resolveTokenInfo: vi.fn((chain: Chain) =>
        chain === Chain.Bitcoin ? { ticker: 'BTC', decimals: 8 } : { ticker: 'ETH', decimals: 18 }
      ),
    })

    await expect(
      vault.swap({
        fromChain: Chain.Bitcoin,
        fromSymbol: 'BTC',
        toChain: Chain.Ethereum,
        toSymbol: 'ETH',
        amount: 'max',
        dryRun: true,
      })
    ).rejects.toThrow(/Cannot compute a fee-aware max/)
  })

  it('returns the minimum warning when max is below the provider recommendation', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 9_022n })
    Object.assign(vault as object, {
      resolveTokenInfo: vi.fn((chain: Chain) =>
        chain === Chain.Bitcoin ? { ticker: 'BTC', decimals: 8 } : { ticker: 'ETH', decimals: 18 }
      ),
    })

    const result = await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.quote.warnings).toContain(
      "Amount 0.00003599 BTC is below THORChain's recommended minimum of 0.00006316 BTC; the swap may fail or be refunded net of fees."
    )
  })
})
