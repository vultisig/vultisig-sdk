/**
 * Swap Commands - thin wrapper around vault.swap()
 */
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import type { Chain, SwapQuoteResult } from '@vultisig/sdk'
import { formatUnits } from 'viem'

import type { CommandContext } from '../core'
import { buildSwapBroadcastIntent, ensureVaultUnlocked, guardedBroadcast } from '../core'
import { ConfirmationRequiredError } from '../core/errors'
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
  amount: string | number
  fromToken?: string
  toToken?: string
}

/**
 * Execute swap-quote command - get quote without executing
 */
export async function executeSwapQuote(ctx: CommandContext, options: SwapQuoteOptions): Promise<SwapQuoteResult> {
  const isMax = options.amount === 'max'
  const amount = normalizeSwapAmount(options.amount)
  const vault = await ctx.ensureActiveVault()

  // Use vault.swap() dry-run to get the quote
  const spinner = createSpinner('Getting swap quote...')

  const result = await vault.swap({
    fromChain: options.fromChain,
    fromSymbol: options.fromToken || '',
    toChain: options.toChain,
    toSymbol: options.toToken || '',
    amount,
    dryRun: true,
  })

  if (!result.dryRun) throw new Error('unreachable')

  spinner.succeed('Quote received')

  const quote = result.quote
  const semanticAmount = isMax ? amount : normalizeSwapAmount(amount, quote.fromCoin.decimals)
  const fromAmountDisplay = isMax
    ? `${formatBigintAmount(quote.maxSwapable, quote.fromCoin.decimals)} (max)`
    : semanticAmount

  if (isJsonOutput()) {
    outputJson({
      fromChain: options.fromChain,
      toChain: options.toChain,
      amount: semanticAmount,
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
  force?: boolean // Bypass the broadcast-journal duplicate guard
  password?: string
  signal?: AbortSignal
} & SwapQuoteOptions

// `toChainAmount` is the SDK's authoritative parser. Using its supported
// precision ceiling here validates and canonicalizes without losing any input
// digits before the source coin's actual decimal count is known.
const SWAP_AMOUNT_CANONICAL_DECIMALS = 10_000

export function normalizeSwapAmount(
  amount: SwapQuoteOptions['amount'],
  decimals = SWAP_AMOUNT_CANONICAL_DECIMALS
): string {
  if (amount === 'max') return amount

  try {
    const chainAmount = toChainAmount(amount, decimals)
    if (chainAmount <= 0n) throw new Error('Invalid amount')
    return formatUnits(chainAmount, decimals)
  } catch {
    throw new Error('Invalid amount')
  }
}

function toSwapRequest(options: SwapOptions, amount: string, dryRun?: true) {
  return {
    fromChain: options.fromChain,
    fromSymbol: options.fromToken || '',
    toChain: options.toChain,
    toSymbol: options.toToken || '',
    amount,
    ...(options.slippage !== undefined && { slippageTolerance: options.slippage }),
    ...(dryRun && { dryRun: true as const }),
  }
}

function toDryRunResult(options: SwapOptions, quote: SwapQuoteResult, fromAmountRaw: string): SwapDryRunResult {
  const result: SwapDryRunResult = {
    dryRun: true,
    fromChain: String(options.fromChain),
    fromToken: quote.fromCoin.ticker,
    toChain: String(options.toChain),
    toToken: quote.toCoin.ticker,
    inputAmount: fromAmountRaw,
    ...(options.amount === 'max' && { isMax: true }),
    estimatedOutput: formatBigintAmount(quote.estimatedOutput, quote.toCoin.decimals),
    provider: quote.provider,
  }

  if (quote.estimatedOutputFiat != null) result.estimatedOutputFiat = parseFloat(quote.estimatedOutputFiat.toFixed(2))
  if (quote.requiresApproval) result.requiresApproval = true
  if (quote.warnings?.length) result.warnings = [...quote.warnings]
  return result
}

function displayDryRunResult(result: SwapDryRunResult): void {
  info(`\nDry-run preview:`)
  info(`  From:             ${result.inputAmount} ${result.fromToken} (${result.fromChain})`)
  info(`  To:               ${result.estimatedOutput} ${result.toToken} (${result.toChain})`)
  info(`  Provider:         ${result.provider}`)
  if (result.estimatedOutputFiat != null) info(`  Est. value (USD): $${result.estimatedOutputFiat}`)
  if (result.requiresApproval) info(`  Requires approval: yes`)
  if (result.warnings?.length) result.warnings.forEach(w => warn(`  Warning: ${w}`))
}

function refuseSwapWhenNonInteractive(): never {
  throw new ConfirmationRequiredError(
    'Swap requires confirmation.',
    'Pass --yes to confirm, or --dry-run to preview without signing.'
  )
}

async function confirmSwapIfNeeded(options: SwapOptions): Promise<void> {
  if (options.yes) return
  if (isNonInteractive()) {
    refuseSwapWhenNonInteractive()
  }
  const confirmed = await confirmSwap()
  if (!confirmed) {
    // Same contract as `send`: an interactive decline exits 12
    // CONFIRMATION_REQUIRED (matching the non-interactive refusal), never the
    // old swallowed exit 0.
    throw new ConfirmationRequiredError('Swap declined at the confirmation prompt')
  }
}

/**
 * Execute swap command: preview -> confirm -> vault.swap()
 */
export async function executeSwap(
  ctx: CommandContext,
  options: SwapOptions
): Promise<{ txHash: string; quote: SwapQuoteResult } | SwapDryRunResult> {
  const amountStr = normalizeSwapAmount(options.amount)
  const vault = await ctx.ensureActiveVault()

  // Fail closed up-front: without --yes this flow ends in an interactive
  // confirmation a non-interactive session can never answer — refuse before the
  // quote preview writes to stdout (or any network work happens).
  if (!options.dryRun && !options.yes && isNonInteractive()) {
    refuseSwapWhenNonInteractive()
  }

  // 1. Dry-run for quote/preview
  const quoteSpinner = createSpinner('Getting swap quote...')

  const dryResult = await vault.swap(toSwapRequest(options, amountStr, true))

  if (!dryResult.dryRun) throw new Error('unreachable')

  quoteSpinner.succeed('Quote received')

  const quote = dryResult.quote
  const semanticAmount = options.amount === 'max' ? amountStr : normalizeSwapAmount(amountStr, quote.fromCoin.decimals)
  const fromAmountRaw =
    options.amount === 'max' ? formatBigintAmount(quote.maxSwapable, quote.fromCoin.decimals) : semanticAmount
  const fromAmountDisplay = options.amount === 'max' ? `${fromAmountRaw} (max)` : fromAmountRaw

  // If user asked for dry-run only, return preview
  if (options.dryRun) {
    const result = toDryRunResult(options, quote, fromAmountRaw)
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      displayDryRunResult(result)
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
  await confirmSwapIfNeeded(options)

  // 4. Unlock and execute via compound method
  await ensureVaultUnlocked(vault, options.password)

  // Refuse a double-spend: fingerprint the swap intent (from/to chain + token +
  // resolved amount) and check it against the persistent broadcast journal
  // (shared with the `agent ask` path) BEFORE signing. A retry of an identical
  // swap that hasn't definitively failed is refused (exit 9) unless --force is
  // passed. The spinner starts INSIDE the guarded callback so a refusal
  // short-circuits before any misleading "Signing..." UI.
  const intent = buildSwapBroadcastIntent(vault, {
    fromChain: options.fromChain,
    toChain: options.toChain,
    fromToken: options.fromToken,
    toToken: options.toToken,
    amount: fromAmountRaw,
    isMax: options.amount === 'max',
  })
  let signSpinner: ReturnType<typeof createSpinner> | undefined

  try {
    const broadcast = await guardedBroadcast(intent, options.force ?? false, async () => {
      signSpinner = createSpinner('Signing swap transaction...')
      vault.on('signingProgress', ({ step }: any) => {
        if (signSpinner) signSpinner.text = `${step.message} (${step.progress}%)`
      })
      const result = await vault.swap(toSwapRequest(options, semanticAmount))
      if (result.dryRun) throw new Error('unreachable')
      return result as Extract<typeof result, { dryRun: false }>
    })

    signSpinner?.succeed(`Swap broadcast: ${broadcast.txHash}`)

    if (isJsonOutput()) {
      outputJson({
        txHash: broadcast.txHash,
        fromChain: options.fromChain,
        toChain: options.toChain,
        quote,
      })
    } else {
      displaySwapResult(options.fromChain, options.toChain, broadcast.txHash, quote, quote.toCoin.decimals)
    }

    return { txHash: broadcast.txHash, quote }
  } catch (err) {
    signSpinner?.stop()
    throw err
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}
