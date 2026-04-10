/**
 * Swap Commands - thin wrapper around vault.swap()
 */
import type { Chain, SwapQuoteResult } from '@vultisig/sdk'

import type { CommandContext } from '../core'
import { ensureVaultUnlocked } from '../core'
import { createSpinner, info, isJsonOutput, isNonInteractive, outputJson, warn } from '../lib/output'
import { confirmSwap, displaySwapChains, displaySwapPreview, displaySwapResult, formatBigintAmount } from '../ui'

/**
 * Execute swap-chains command - list supported swap chains
 */
export async function executeSwapChains(ctx: CommandContext): Promise<readonly Chain[]> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner('Loading supported swap chains...')
  const chains = await vault.getSupportedSwapChains()
  spinner.succeed('Swap chains loaded')

  if (isJsonOutput()) {
    outputJson({ swapChains: [...chains] })
    return chains
  }

  displaySwapChains(chains)
  return chains
}

export type SwapQuoteOptions = {
  fromChain: Chain
  toChain: Chain
  amount: number | 'max'
  fromToken?: string
  toToken?: string
}

/**
 * Execute swap-quote command - get quote without executing
 */
export async function executeSwapQuote(ctx: CommandContext, options: SwapQuoteOptions): Promise<SwapQuoteResult> {
  const vault = await ctx.ensureActiveVault()

  const isMax = options.amount === 'max'
  if (!isMax && (isNaN(options.amount as number) || (options.amount as number) <= 0)) {
    throw new Error('Invalid amount')
  }

  // Use vault.swap() dry-run to get the quote
  const spinner = createSpinner('Getting swap quote...')

  const result = await vault.swap({
    fromChain: options.fromChain,
    fromSymbol: options.fromToken || '',
    toChain: options.toChain,
    toSymbol: options.toToken || '',
    amount: isMax ? 'max' : String(options.amount),
    dryRun: true,
  })

  if (!result.dryRun) throw new Error('unreachable')

  spinner.succeed('Quote received')

  const quote = result.quote
  const fromAmountDisplay = isMax
    ? `${formatBigintAmount(quote.maxSwapable, quote.fromCoin.decimals)} (max)`
    : String(options.amount)

  if (isJsonOutput()) {
    outputJson({
      fromChain: options.fromChain,
      toChain: options.toChain,
      amount: isMax ? 'max' : options.amount,
      isMax,
      quote,
    })
    return quote
  }

  const feeBalance = await vault.balance(options.fromChain)
  const discountTier = await vault.getDiscountTier()

  displaySwapPreview(quote, fromAmountDisplay, quote.fromCoin.ticker, quote.toCoin.ticker, {
    fromDecimals: quote.fromCoin.decimals,
    toDecimals: quote.toCoin.decimals,
    feeDecimals: feeBalance.decimals,
    feeSymbol: feeBalance.symbol,
    discountTier,
  })

  info('\nTo execute this swap, use the "swap" command')

  return quote
}

export type SwapDryRunResult = {
  dryRun: true
  fromChain: string
  fromToken: string
  toChain: string
  toToken: string
  inputAmount: string
  isMax?: boolean
  estimatedOutput: string
  provider: string
  estimatedOutputFiat?: number
  requiresApproval?: boolean
  warnings?: string[]
}

export type SwapOptions = {
  slippage?: number
  yes?: boolean
  dryRun?: boolean
  password?: string
  signal?: AbortSignal
} & SwapQuoteOptions

/**
 * Execute swap command: preview -> confirm -> vault.swap()
 */
export async function executeSwap(
  ctx: CommandContext,
  options: SwapOptions
): Promise<{ txHash: string; quote: SwapQuoteResult } | SwapDryRunResult> {
  const vault = await ctx.ensureActiveVault()

  const isMax = options.amount === 'max'
  if (!isMax && (isNaN(options.amount as number) || (options.amount as number) <= 0)) {
    throw new Error('Invalid amount')
  }

  const amountStr = isMax ? 'max' : String(options.amount)

  // 1. Dry-run for quote/preview
  const quoteSpinner = createSpinner('Getting swap quote...')

  const dryResult = await vault.swap({
    fromChain: options.fromChain,
    fromSymbol: options.fromToken || '',
    toChain: options.toChain,
    toSymbol: options.toToken || '',
    amount: amountStr,
    dryRun: true,
  })

  if (!dryResult.dryRun) throw new Error('unreachable')

  quoteSpinner.succeed('Quote received')

  const quote = dryResult.quote
  const fromAmountRaw = isMax ? formatBigintAmount(quote.maxSwapable, quote.fromCoin.decimals) : String(options.amount)
  const fromAmountDisplay = isMax ? `${fromAmountRaw} (max)` : fromAmountRaw

  // If user asked for dry-run only, return preview
  if (options.dryRun) {
    const estimatedOutput = formatBigintAmount(quote.estimatedOutput, quote.toCoin.decimals)
    const result: SwapDryRunResult = {
      dryRun: true,
      fromChain: String(options.fromChain),
      fromToken: quote.fromCoin.ticker,
      toChain: String(options.toChain),
      toToken: quote.toCoin.ticker,
      inputAmount: fromAmountRaw,
      ...(isMax && { isMax: true }),
      estimatedOutput,
      provider: quote.provider,
    }
    if (quote.estimatedOutputFiat != null) {
      result.estimatedOutputFiat = parseFloat(quote.estimatedOutputFiat.toFixed(2))
    }
    if (quote.requiresApproval) {
      result.requiresApproval = true
    }
    if (quote.warnings && quote.warnings.length > 0) {
      result.warnings = [...quote.warnings]
    }
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      info(`\nDry-run preview:`)
      info(`  From:             ${result.inputAmount} ${result.fromToken} (${result.fromChain})`)
      info(`  To:               ${result.estimatedOutput} ${result.toToken} (${result.toChain})`)
      info(`  Provider:         ${result.provider}`)
      if (result.estimatedOutputFiat != null) info(`  Est. value (USD): $${result.estimatedOutputFiat}`)
      if (result.requiresApproval) info(`  Requires approval: yes`)
      if (result.warnings?.length) result.warnings.forEach(w => warn(`  Warning: ${w}`))
    }
    return result
  }

  // 2. Show preview
  const feeBalance = await vault.balance(options.fromChain)
  const discountTier = await vault.getDiscountTier()

  if (!isJsonOutput()) {
    displaySwapPreview(quote, fromAmountDisplay, quote.fromCoin.ticker, quote.toCoin.ticker, {
      fromDecimals: quote.fromCoin.decimals,
      toDecimals: quote.toCoin.decimals,
      feeDecimals: feeBalance.decimals,
      feeSymbol: feeBalance.symbol,
      discountTier,
    })
  }

  // 3. Confirm (required in all output modes)
  if (!options.yes) {
    if (isNonInteractive()) {
      throw new Error('Swap requires confirmation. Use --yes to skip, or --dry-run to preview.')
    }
    const confirmed = await confirmSwap()
    if (!confirmed) {
      warn('Swap cancelled')
      throw new Error('Swap cancelled by user')
    }
  }

  // 4. Unlock and execute via compound method
  await ensureVaultUnlocked(vault, options.password)

  const signSpinner = createSpinner('Signing swap transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  try {
    const result = await vault.swap({
      fromChain: options.fromChain,
      fromSymbol: options.fromToken || '',
      toChain: options.toChain,
      toSymbol: options.toToken || '',
      amount: amountStr,
    })

    if (result.dryRun) throw new Error('unreachable')

    signSpinner.succeed(`Swap broadcast: ${result.txHash}`)

    if (isJsonOutput()) {
      outputJson({
        txHash: result.txHash,
        fromChain: options.fromChain,
        toChain: options.toChain,
        quote,
      })
    } else {
      displaySwapResult(options.fromChain, options.toChain, result.txHash, quote, quote.toCoin.decimals)
    }

    return { txHash: result.txHash, quote }
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}
