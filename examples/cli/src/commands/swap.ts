/**
 * Swap Commands - swap-chains, swap-quote, swap
 */
import type { Chain, SwapQuoteResult } from '@vultisig/sdk/node'

import type { CommandContext } from '../core'
import { confirmSwap, createSpinner, displaySwapChains, displaySwapPreview, displaySwapResult, info, warn } from '../ui'

/**
 * Execute swap-chains command - list supported swap chains
 */
export async function executeSwapChains(ctx: CommandContext): Promise<readonly Chain[]> {
  const vault = await ctx.ensureActiveVault()

  const spinner = createSpinner('Loading supported swap chains...')
  const chains = await vault.getSupportedSwapChains()
  spinner.succeed('Swap chains loaded')

  displaySwapChains(chains)
  return chains
}

export type SwapQuoteOptions = {
  fromChain: Chain
  toChain: Chain
  amount: number
  fromToken?: string
  toToken?: string
}

/**
 * Execute swap-quote command - get quote without executing
 */
export async function executeSwapQuote(ctx: CommandContext, options: SwapQuoteOptions): Promise<SwapQuoteResult> {
  const vault = await ctx.ensureActiveVault()

  if (isNaN(options.amount) || options.amount <= 0) {
    throw new Error('Invalid amount')
  }

  // Check swap support
  const isSupported = await vault.isSwapSupported(options.fromChain, options.toChain)
  if (!isSupported) {
    throw new Error(`Swaps from ${options.fromChain} to ${options.toChain} are not supported`)
  }

  const spinner = createSpinner('Getting swap quote...')

  const quote = await vault.getSwapQuote({
    fromCoin: { chain: options.fromChain, token: options.fromToken },
    toCoin: { chain: options.toChain, token: options.toToken },
    amount: options.amount,
  })

  spinner.succeed('Quote received')

  // Get symbols for display
  const fromBalance = await vault.balance(options.fromChain, options.fromToken)
  const toBalance = await vault.balance(options.toChain, options.toToken)

  displaySwapPreview(quote, String(options.amount), fromBalance.symbol, toBalance.symbol)

  info('\nTo execute this swap, use the "swap" command')

  return quote
}

export type SwapOptions = {
  slippage?: number
} & SwapQuoteOptions

/**
 * Execute swap command - perform a cross-chain swap
 */
export async function executeSwap(
  ctx: CommandContext,
  options: SwapOptions
): Promise<{ txHash: string; quote: SwapQuoteResult }> {
  const vault = await ctx.ensureActiveVault()

  if (isNaN(options.amount) || options.amount <= 0) {
    throw new Error('Invalid amount')
  }

  // Check swap support
  const isSupported = await vault.isSwapSupported(options.fromChain, options.toChain)
  if (!isSupported) {
    throw new Error(`Swaps from ${options.fromChain} to ${options.toChain} are not supported`)
  }

  // 1. Get swap quote
  const quoteSpinner = createSpinner('Getting swap quote...')

  const quote = await vault.getSwapQuote({
    fromCoin: { chain: options.fromChain, token: options.fromToken },
    toCoin: { chain: options.toChain, token: options.toToken },
    amount: options.amount,
  })

  quoteSpinner.succeed('Quote received')

  // Get symbols for display
  const fromBalance = await vault.balance(options.fromChain, options.fromToken)
  const toBalance = await vault.balance(options.toChain, options.toToken)

  // 2. Display preview
  displaySwapPreview(quote, String(options.amount), fromBalance.symbol, toBalance.symbol)

  // 3. Confirm with user
  const confirmed = await confirmSwap()
  if (!confirmed) {
    warn('Swap cancelled')
    throw new Error('Swap cancelled by user')
  }

  // 4. Prepare swap transaction
  const prepSpinner = createSpinner('Preparing swap transaction...')

  const { keysignPayload, approvalPayload } = await vault.prepareSwapTx({
    fromCoin: { chain: options.fromChain, token: options.fromToken },
    toCoin: { chain: options.toChain, token: options.toToken },
    amount: options.amount,
    swapQuote: quote,
    autoApprove: false,
  })

  prepSpinner.succeed('Swap prepared')

  // 5. Handle approval if needed
  if (approvalPayload) {
    info('\nToken approval required before swap...')

    const approvalSpinner = createSpinner('Signing approval transaction...')

    vault.on('signingProgress', ({ step }: any) => {
      approvalSpinner.text = `Approval: ${step.message} (${step.progress}%)`
    })

    try {
      const approvalHashes = await vault.extractMessageHashes(approvalPayload)
      const approvalSig = await vault.sign({
        transaction: approvalPayload,
        chain: options.fromChain,
        messageHashes: approvalHashes,
      })

      approvalSpinner.succeed('Approval signed')

      const broadcastApprovalSpinner = createSpinner('Broadcasting approval...')
      const approvalTxHash = await vault.broadcastTx({
        chain: options.fromChain,
        keysignPayload: approvalPayload,
        signature: approvalSig,
      })

      broadcastApprovalSpinner.succeed(`Approval broadcast: ${approvalTxHash}`)
      info('Waiting for approval to confirm...')

      // Wait a bit for approval to be mined
      await new Promise(resolve => setTimeout(resolve, 5000))
    } finally {
      vault.removeAllListeners('signingProgress')
    }
  }

  // 6. Sign main swap transaction
  const signSpinner = createSpinner('Signing swap transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  try {
    const messageHashes = await vault.extractMessageHashes(keysignPayload)
    const signature = await vault.sign({
      transaction: keysignPayload,
      chain: options.fromChain,
      messageHashes,
    })

    signSpinner.succeed('Swap transaction signed')

    // 7. Broadcast swap
    const broadcastSpinner = createSpinner('Broadcasting swap transaction...')

    const txHash = await vault.broadcastTx({
      chain: options.fromChain,
      keysignPayload,
      signature,
    })

    broadcastSpinner.succeed(`Swap broadcast: ${txHash}`)

    // 8. Display result
    displaySwapResult(options.fromChain, options.toChain, txHash, quote)

    return { txHash, quote }
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}
