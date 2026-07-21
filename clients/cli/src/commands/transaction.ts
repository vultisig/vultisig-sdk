/**
 * Transaction Commands - thin wrapper around vault.send()
 */
import { normalizeRippleDestination } from '@vultisig/core-chain/chains/ripple/address'
import type { VaultBase } from '@vultisig/sdk'
import { Chain, Vultisig } from '@vultisig/sdk'

import type { CommandContext, SendDryRunResult, SendParams, TransactionResult } from '../core'
import { buildSendBroadcastIntent, ensureVaultUnlocked, guardedBroadcast } from '../core'
import { ConfirmationRequiredError } from '../core/errors'
import { createSpinner, info, isJsonOutput, isNonInteractive, outputJson, warn } from '../lib/output'
import { confirmTransaction, displayTransactionPreview, displayTransactionResult } from '../ui'

/**
 * Execute send command - send tokens to an address
 */
export async function executeSend(
  ctx: CommandContext,
  params: SendParams
): Promise<TransactionResult | SendDryRunResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new Error(`Invalid chain: ${params.chain}`)
  }

  const isMax = params.amount === 'max'
  if (!isMax && (isNaN(parseFloat(params.amount)) || parseFloat(params.amount) <= 0)) {
    throw new Error('Invalid amount')
  }

  return sendTransaction(vault, params)
}

/**
 * Send transaction: preview -> confirm -> vault.send()
 */
export async function sendTransaction(
  vault: VaultBase,
  params: SendParams
): Promise<TransactionResult | SendDryRunResult> {
  // Fail closed up-front: without --yes this flow ends in an interactive
  // confirmation a non-interactive session can never answer — refuse before
  // the preview writes to stdout (or any network work happens).
  if (!params.dryRun && !params.yes && isNonInteractive()) {
    throw new ConfirmationRequiredError(
      'Transaction requires confirmation.',
      'Pass --yes to confirm, or --dry-run to preview without signing.'
    )
  }

  const rippleDestination =
    params.chain === Chain.Ripple ? normalizeRippleDestination(params.to) : { address: params.to }
  const to = rippleDestination.address
  if (
    params.destinationTag !== undefined &&
    rippleDestination.destinationTag !== undefined &&
    params.destinationTag !== rippleDestination.destinationTag
  ) {
    throw new Error(
      `Conflicting XRP destination tags: --destination-tag=${params.destinationTag} does not match the tag embedded in the X-address (${rippleDestination.destinationTag})`
    )
  }
  const destinationTag = params.destinationTag ?? rippleDestination.destinationTag

  // 1. Dry-run for preview
  const prepareSpinner = createSpinner('Preparing transaction...')

  const dryResult = await vault.send({
    chain: params.chain,
    to: params.to,
    amount: params.amount,
    symbol: params.tokenId,
    memo: params.memo,
    destinationTag,
    dryRun: true,
  })

  prepareSpinner.succeed('Transaction prepared')

  if (!dryResult.dryRun) throw new Error('unreachable')

  // If user asked for dry-run only, return preview
  if (params.dryRun) {
    const balance = await vault.balance(params.chain, params.tokenId)
    const hasInsufficientBalance = parseFloat(dryResult.total) > parseFloat(balance.formattedAmount)
    // fee/total come straight from the build the SDK just did. They were previously
    // dropped from the JSON result even though the human preview below prints the fee
    // and `total` is what the insufficient-balance check compares against — so
    // `--dry-run -o json` looked like a bare balance check with no cost information.
    const result: SendDryRunResult = {
      dryRun: true,
      chain: params.chain,
      to,
      amount: params.amount,
      symbol: balance.symbol,
      fee: dryResult.fee,
      total: dryResult.total,
      balance: balance.formattedAmount,
      destinationTag,
    }
    if (hasInsufficientBalance) {
      result.warning = `Insufficient balance: you have ${balance.formattedAmount} ${balance.symbol}`
    }
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      info(`\nDry-run preview:`)
      info(`  Chain:   ${result.chain}`)
      info(`  To:      ${result.to}`)
      info(`  Amount:  ${result.amount} ${result.symbol}`)
      if (result.destinationTag !== undefined) info(`  Destination tag: ${result.destinationTag}`)
      info(`  Fee:     ${result.fee} ${result.symbol}`)
      info(`  Total:   ${result.total} ${result.symbol}`)
      info(`  Balance: ${result.balance} ${result.symbol}`)
      if (result.warning) warn(`  Warning: ${result.warning}`)
    }
    return result
  }

  // 2. Show preview and get gas estimate
  let gas: Awaited<ReturnType<typeof vault.gas>> | undefined
  try {
    gas = await vault.gas(params.chain)
  } catch {
    warn('\nGas estimation unavailable')
  }

  const balance = await vault.balance(params.chain, params.tokenId)
  if (!isJsonOutput()) {
    const address = await vault.address(params.chain)
    displayTransactionPreview(
      address,
      to,
      dryResult.total,
      balance.symbol,
      params.chain,
      params.memo,
      destinationTag,
      gas
    )
  }

  // 3. Confirm (required in all output modes; the non-interactive case was
  // refused up-front, before the preview)
  if (!params.yes) {
    const confirmed = await confirmTransaction()
    if (!confirmed) {
      // A human declining at the prompt is the interactive twin of the
      // non-interactive refusal (confirmTransaction → requireInteractive →
      // ConfirmationRequiredError): both must exit 12 CONFIRMATION_REQUIRED /
      // success:false. The old plain Error was swallowed to exit 0 in index.ts,
      // telling a scripted caller a declined send had "succeeded".
      throw new ConfirmationRequiredError('Transaction declined at the confirmation prompt')
    }
  }

  // 4. Unlock and sign via compound method
  await ensureVaultUnlocked(vault, params.password)

  // Refuse a double-spend: fingerprint the resolved tx and check it against the
  // persistent broadcast journal (shared with the `agent ask` path) BEFORE
  // signing. A retry of an identical send that hasn't definitively failed is
  // refused (exit 9) unless --force is passed. The spinner is created INSIDE the
  // guarded callback so a refusal short-circuits before any misleading
  // "Signing..." UI, and the broadcast hash is journaled the instant it returns.
  const intent = buildSendBroadcastIntent(vault, params.chain, dryResult.keysignPayload, {
    isMax: params.amount === 'max',
  })
  let signSpinner: ReturnType<typeof createSpinner> | undefined

  try {
    const broadcast = await guardedBroadcast(intent, params.force ?? false, async () => {
      signSpinner = createSpinner(
        vault.type === 'secure' ? 'Preparing secure signing session...' : 'Signing transaction...'
      )
      vault.on('signingProgress', ({ step }: any) => {
        if (signSpinner) signSpinner.text = `${step.message} (${step.progress}%)`
      })
      const result = await vault.send({
        chain: params.chain,
        to: params.to,
        amount: params.amount,
        symbol: params.tokenId,
        memo: params.memo,
        destinationTag,
      })
      if (result.dryRun) throw new Error('unreachable')
      return result as Extract<typeof result, { dryRun: false }>
    })

    signSpinner?.succeed(`Transaction broadcast: ${broadcast.txHash}`)

    const txResult: TransactionResult = {
      txHash: broadcast.txHash,
      chain: params.chain,
      explorerUrl: Vultisig.getTxExplorerUrl(params.chain, broadcast.txHash),
    }

    if (isJsonOutput()) {
      outputJson(txResult)
    } else {
      displayTransactionResult(params.chain, broadcast.txHash)
    }

    return txResult
  } catch (err) {
    signSpinner?.stop()
    throw err
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}
