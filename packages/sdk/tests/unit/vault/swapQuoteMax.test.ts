import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getNativeSwapMinAmountIn = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const findSwapQuote = vi.hoisted(() => vi.fn())
const providerPreferenceOrder = vi.hoisted(
  () => ['CowSwap', 'RUJI Trade', 'THORChain', 'MayaChain', 'Jupiter', 'SwapKit', 'KyberSwap', '1inch', 'LiFi'] as const
)

vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn,
}))
vi.mock('@vultisig/core-chain/swap/quote/findSwapQuote', () => ({
  findSwapQuote,
  getSwapQuoteProviderName: vi.fn(quote =>
    'native' in quote ? (quote.native.swapChain as (typeof providerPreferenceOrder)[number]) : 'SwapKit'
  ),
  providerPreferenceOrder,
}))

import { SwapService } from '@/vault/services/SwapService'
import { VaultBase } from '@/vault/VaultBase'
import { VaultErrorCode } from '@/vault/VaultError'

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

const atom: AccountCoin = {
  chain: Chain.Cosmos,
  address: 'cosmos1source',
  ticker: 'ATOM',
  decimals: 6,
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

const generalEvmQuote = ({ fee }: { fee: bigint }) => ({
  quote: {
    quote: {
      general: {
        dstAmount: '100000000',
        provider: '1inch' as const,
        tx: {
          evm: { from: eth.address, to: eth.address, data: '0x', value: '0' },
        },
      },
    },
    discounts: [],
    requestedAmount: 1n,
    expiresAt: Date.now() + 60_000,
    safetyFingerprint: 'fingerprint',
  },
  estimatedOutput: 100_000_000n,
  provider: '1inch',
  expiresAt: Date.now() + 60_000,
  requiresApproval: false,
  fees: { network: fee, total: fee },
  warnings: [] as string[],
  fromCoin: { chain: eth.chain, ticker: eth.ticker, decimals: eth.decimals },
  toCoin: { chain: btc.chain, ticker: btc.ticker, decimals: btc.decimals },
})

function makeVault({
  quote,
  balance,
  fee,
}: {
  quote: unknown
  balance: bigint
  fee: bigint | Error | (bigint | Error)[]
}) {
  const estimateSendFee = vi.fn()
  if (Array.isArray(fee)) {
    fee.forEach(value => {
      if (value instanceof Error) estimateSendFee.mockRejectedValueOnce(value)
      else estimateSendFee.mockResolvedValueOnce(value)
    })
  } else if (fee instanceof Error) {
    estimateSendFee.mockRejectedValue(fee)
  } else {
    estimateSendFee.mockResolvedValue(fee)
  }
  const vault = Object.create(VaultBase.prototype) as VaultBase
  Object.assign(vault as object, {
    swapService: {
      getQuote: vi.fn().mockResolvedValue(quote),
      getFeesFiat: vi.fn().mockResolvedValue(undefined),
    },
    balanceService: {
      getBalance: vi.fn().mockResolvedValue({ amount: balance.toString() }),
    },
    transactionBuilder: { estimateSendFee },
    address: vi.fn(async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address)),
  })
  return { vault, estimateSendFee }
}

function configureCompoundSwap(vault: VaultBase) {
  Object.assign(vault as object, {
    resolveTokenInfo: vi.fn((chain: Chain) => {
      if (chain === Chain.Bitcoin) return { ticker: 'BTC', decimals: 8 }
      if (chain === Chain.Cosmos) return { ticker: 'ATOM', decimals: 6 }
      return { ticker: 'ETH', decimals: 18 }
    }),
  })
}

describe('VaultBase.getSwapQuote fee-aware maximums', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getNativeSwapMinAmountIn.mockResolvedValue(null)
  })

  it('carries a raw THORChain quote through SwapService and surfaces the estimated BTC fee', async () => {
    const rawQuote = nativeQuote({ from: btc, to: eth }).quote
    rawQuote.quote.native.fees.affiliate = '125'
    findSwapQuote.mockResolvedValue(rawQuote)
    const getPrice = vi.fn().mockResolvedValue(50_000)
    const swapService = new SwapService(
      {} as never,
      async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address),
      vi.fn(),
      {} as never,
      { getPrice } as never
    )
    const vault = Object.create(VaultBase.prototype) as VaultBase
    Object.assign(vault as object, {
      swapService,
      balanceService: {
        getBalance: vi.fn().mockResolvedValue({ amount: '12621' }),
      },
      transactionBuilder: { estimateSendFee: vi.fn().mockResolvedValue(500n) },
      address: vi.fn(async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address)),
    })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
      fiatCurrency: 'usd',
    })

    expect(result.maxSwapable).toBe(12_121n)
    expect(result.maxSwapable).not.toBe(3_599n)
    expect(result.fees).toEqual({ network: 500n, total: 500n })
    expect(result.feesFiat).toEqual({
      network: 0.25,
      affiliate: undefined,
      total: 0.25,
      currency: 'usd',
    })
  })

  it('leaves estimated native fee fiat values undefined when pricing fails', async () => {
    const rawQuote = nativeQuote({ from: btc, to: eth }).quote
    findSwapQuote.mockResolvedValue(rawQuote)
    const swapService = new SwapService(
      {} as never,
      async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address),
      vi.fn(),
      {} as never,
      {
        getPrice: vi.fn().mockRejectedValue(new Error('price unavailable')),
      } as never
    )
    const vault = Object.create(VaultBase.prototype) as VaultBase
    Object.assign(vault as object, {
      swapService,
      balanceService: {
        getBalance: vi.fn().mockResolvedValue({ amount: '12621' }),
      },
      transactionBuilder: { estimateSendFee: vi.fn().mockResolvedValue(500n) },
      address: vi.fn(async (chain: Chain) => (chain === Chain.Bitcoin ? btc.address : eth.address)),
    })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
      fiatCurrency: 'usd',
    })

    expect(result.fees).toEqual({ network: 500n, total: 500n })
    expect(result.feesFiat).toBeUndefined()
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
    expect(result.fees.network).toBe(500n)
    expect(result.fees.total).toBe(500n)
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

  it.each([0n, -1n, 12_621n, 12_622n])('fails closed when the native source fee estimate is %s', async fee => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00012621',
    })
    expect(result.maxSwapable).toBe(0n)

    configureCompoundSwap(vault)
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

  it('does not warn when a native swap amount is above the provider recommended minimum', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 500n })

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00007',
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

    const result = await vault.getSwapQuote({
      fromCoin: btc,
      toCoin: eth,
      amount: '0.00003599',
    })

    expect(getNativeSwapMinAmountIn).toHaveBeenCalledWith({
      from: btc,
      to: eth,
      swapChain: Chain.THORChain,
    })
    expect(result.warnings[0]).toContain('0.00003599 BTC')
    expect(result.warnings[0]).toContain('0.00006316 BTC')
  })

  it('keeps deposit-channel transfer route maximums at zero without calling the estimator', async () => {
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

    expect(result.maxSwapable).toBe(0n)
    expect(estimateSendFee).not.toHaveBeenCalled()
  })

  it('keeps a zero-fee general EVM route maximum at zero without calling the estimator', async () => {
    const quote = generalEvmQuote({ fee: 0n })
    const { vault, estimateSendFee } = makeVault({
      quote,
      balance: 10n ** 18n,
      fee: 21_000n,
    })

    const result = await vault.getSwapQuote({
      fromCoin: eth,
      toCoin: btc,
      amount: '1',
    })

    expect(result.maxSwapable).toBe(0n)
    expect(estimateSendFee).not.toHaveBeenCalled()
  })

  it('subtracts a real general EVM network fee without calling the estimator', async () => {
    const balance = 10n ** 18n
    const quote = generalEvmQuote({ fee: 21_000n })
    const { vault, estimateSendFee } = makeVault({
      quote,
      balance,
      fee: 99_000n,
    })

    const result = await vault.getSwapQuote({
      fromCoin: eth,
      toCoin: btc,
      amount: '1',
    })

    expect(result.maxSwapable).toBe(balance - 21_000n)
    expect(estimateSendFee).not.toHaveBeenCalled()
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

  it('still evaluates the native route minimum for token sources without estimating a fee', async () => {
    const quote = nativeQuote({ from: usdc, to: btc })
    const { vault, estimateSendFee } = makeVault({ quote, balance: 25_000_000n, fee: 21_000n })

    const result = await vault.getSwapQuote({ fromCoin: usdc, toCoin: btc, amount: '0.000063' })

    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('0.000064 USDC')
    expect(estimateSendFee).not.toHaveBeenCalled()
  })

  it.each([
    ['0.000063', true],
    ['0.000064', false],
  ])('rounds a 6-decimal source minimum up for amount %s', async (amount, shouldWarn) => {
    const quote = nativeQuote({ from: atom, to: eth })
    const { vault } = makeVault({ quote, balance: 1_000_000n, fee: 50n })

    const result = await vault.getSwapQuote({ fromCoin: atom, toCoin: eth, amount })

    expect(result.warnings.length > 0).toBe(shouldWarn)
    if (shouldWarn) expect(result.warnings[0]).toContain('0.000064 ATOM')
  })
})

describe('VaultBase.swap max safeguards', () => {
  it('throws the existing fee-aware max error when source-fee estimation fails', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: new Error('fee unavailable'),
    })
    configureCompoundSwap(vault)

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

  it('refuses a native max below the provider recommended minimum', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 9_022n })
    configureCompoundSwap(vault)

    const swap = vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
      dryRun: true,
    })

    await expect(swap).rejects.toMatchObject({
      code: VaultErrorCode.InvalidAmount,
    })
    await expect(swap).rejects.toThrow(
      "Max swappable 0.00003599 BTC is below THORChain's recommended minimum of 0.00006316 BTC"
    )
  })

  it('keeps an explicit below-minimum native amount as a warning', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: 500n })
    configureCompoundSwap(vault)

    const result = await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: '0.00003599',
      dryRun: true,
    })

    expect(result.dryRun).toBe(true)
    expect(result.quote.warnings[0]).toContain('0.00003599 BTC')
  })

  it('pins max requotes to the provider selected by the probe', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: [500n, 500n] })
    configureCompoundSwap(vault)

    await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
      excludeProviders: ['LiFi'],
      dryRun: true,
    })

    expect((vault as any).swapService.getQuote).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        excludeProviders: ['LiFi', ...providerPreferenceOrder.filter(name => name !== 'THORChain')],
      })
    )
  })

  it('clamps once when the source-chain fee rises between the probe and requote', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: [500n, 505n, 505n],
    })
    configureCompoundSwap(vault)

    const result = await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
      dryRun: true,
    })

    expect((vault as any).swapService.getQuote).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ amount: '0.00012121' })
    )
    expect((vault as any).swapService.getQuote).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ amount: '0.00012116' })
    )
    expect(result).toMatchObject({ dryRun: true, amount: '0.00012116' })
  })

  it('throws when a single clamp cannot converge on the source-chain fee', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: [500n, 505n, 511n],
    })
    configureCompoundSwap(vault)

    await expect(
      vault.swap({
        fromChain: Chain.Bitcoin,
        fromSymbol: 'BTC',
        toChain: Chain.Ethereum,
        toSymbol: 'ETH',
        amount: 'max',
        dryRun: true,
      })
    ).rejects.toThrow('The source-chain fee changed between quotes; retry the swap.')
    expect((vault as any).swapService.getQuote).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ amount: '0.00012116' })
    )
  })

  it('refuses when the clamped max falls below the provider recommended minimum', async () => {
    const quote = nativeQuote({
      from: btc,
      to: eth,
      recommendedMinimum: '12118',
    })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: [500n, 505n, 505n],
    })
    configureCompoundSwap(vault)

    await expect(
      vault.swap({
        fromChain: Chain.Bitcoin,
        fromSymbol: 'BTC',
        toChain: Chain.Ethereum,
        toSymbol: 'ETH',
        amount: 'max',
        dryRun: true,
      })
    ).rejects.toThrow("Max swappable 0.00012116 BTC is below THORChain's recommended minimum of 0.00012118 BTC")
  })

  it('fails closed when the pinned native-source requote cannot compute a max', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({
      quote,
      balance: 12_621n,
      fee: [500n, new Error('fee unavailable')],
    })
    configureCompoundSwap(vault)

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

  it('allows max with one requote when the source-chain fee is unchanged', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: [500n, 500n] })
    configureCompoundSwap(vault)

    const result = await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
      dryRun: true,
    })

    expect((vault as any).swapService.getQuote).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ dryRun: true, amount: '0.00012121' })
    expect(result.quote.maxSwapable).toBe(12_121n)
  })

  it('returns the committed amount on an executed swap', async () => {
    const quote = nativeQuote({ from: btc, to: eth })
    const { vault } = makeVault({ quote, balance: 12_621n, fee: [500n, 500n] })
    configureCompoundSwap(vault)
    Object.assign(vault as object, {
      prepareSwapTx: vi.fn().mockResolvedValue({ keysignPayload: {} }),
      extractMessageHashes: vi.fn().mockResolvedValue([]),
      sign: vi.fn().mockResolvedValue({}),
      broadcastTx: vi.fn().mockResolvedValue('tx-hash'),
    })

    const result = await vault.swap({
      fromChain: Chain.Bitcoin,
      fromSymbol: 'BTC',
      toChain: Chain.Ethereum,
      toSymbol: 'ETH',
      amount: 'max',
    })

    expect(result).toMatchObject({
      dryRun: false,
      amount: '0.00012121',
      txHash: 'tx-hash',
    })
    expect((vault as any).prepareSwapTx).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.00012121' }))
  })
})
