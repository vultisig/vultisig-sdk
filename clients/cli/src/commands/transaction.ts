/**
 * Transaction Commands - thin wrapper around vault.send()
 */
import { normalizeRippleDestination } from '@vultisig/core-chain/chains/ripple/address'
import { getLegacyDestinationTag, resolveDestinationTag } from '@vultisig/core-mpc/keysign/utils/rippleDestinationTag'
import type { KeysignPayload, VaultBase } from '@vultisig/sdk'
import { Chain, Vultisig } from '@vultisig/sdk'

import type { CommandContext, SendDryRunResult, SendParams, TransactionResult } from '../core'
import { buildSendBroadcastIntent, ensureVaultUnlocked, guardedBroadcast } from '../core'
import { ConfirmationRequiredError } from '../core/errors'
import { createSpinner, info, isJsonOutput, isNonInteractive, outputJson, warn } from '../lib/output'
import { confirmTransaction, displayTransactionPreview, displayTransactionResult, escapeTerminalControls } from '../ui'

/**
 * Compute the resolved max-send display amount from what the SDK already
 * returned. bead vultisig-2lnf8.
 *
 * - Token max: `dryResult.total` IS the amount (fee is paid in a different
 *   token, per VaultBase.ts:1782 isTokenSend branch). Pass through unchanged.
 * - Native max: `dryResult.total = amountBigInt + fee` at the SDK layer, so
 *   the display amount is `total - fee`. Uses BigInt-scaled arithmetic on the
 *   decimal strings so 18-decimal chains don't lose precision through float
 *   subtraction.
 */
export const resolvedMaxAmount = (isTokenSend: boolean, total: string, fee: string): string => {
  if (isTokenSend) return total
  // Decide the scale from the widest fractional part; then convert both to that
  // scale as BigInt, subtract, and format back. Handles arbitrary decimal widths
  // (chains from 6dec cosmos to 18dec ETH share this path).
  const totalDot = total.indexOf('.')
  const feeDot = fee.indexOf('.')
  const totalFrac = totalDot < 0 ? 0 : total.length - totalDot - 1
  const feeFrac = feeDot < 0 ? 0 : fee.length - feeDot - 1
  const scale = Math.max(totalFrac, feeFrac)
  const scaleBI = (s: string): bigint => {
    const dot = s.indexOf('.')
    const whole = dot < 0 ? s : s.slice(0, dot)
    const frac = dot < 0 ? '' : s.slice(dot + 1)
    const padded = frac.padEnd(scale, '0')
    return BigInt((whole || '0') + padded)
  }
  const diff = scaleBI(total) - scaleBI(fee)
  if (diff <= 0n) return '0'
  if (scale === 0) return diff.toString()
  const s = diff.toString().padStart(scale + 1, '0')
  const whole = s.slice(0, -scale) || '0'
  const frac = s.slice(-scale).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

const getSendPreviewDetails = (
  chain: Chain,
  keysignPayload: KeysignPayload
): { memo: string | undefined; destinationTag: number | undefined } => {
  let memo = keysignPayload.memo || undefined

  if (chain !== Chain.Ripple) {
    return { memo, destinationTag: undefined }
  }

  const rippleSpecific = keysignPayload.blockchainSpecific
  if (rippleSpecific.case !== 'rippleSpecific') {
    throw new Error('Ripple send payload is missing Ripple-specific data')
  }

  const destinationTag = resolveDestinationTag({
    destinationTag: rippleSpecific.value.destinationTag,
    memo,
  })
  const legacyMemoDestinationTag = getLegacyDestinationTag(memo)
  if (legacyMemoDestinationTag !== undefined && legacyMemoDestinationTag === destinationTag) {
    memo = undefined
  }

  return { memo, destinationTag }
}

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
 * Build (and emit) the `--dry-run` preview.
 *
 * A module-level function rather than an inline block: it is the whole of what
 * `--dry-run` does, and keeping it here leaves `sendTransaction` about the
 * confirm-and-sign flow.
 */
async function previewDryRun(
  vault: VaultBase,
  params: SendParams,
  dryResult: { fee: string; feeSymbol: string; total: string; keysignPayload: KeysignPayload },
  to: string
): Promise<SendDryRunResult> {
  const balance = await vault.balance(params.chain, params.tokenId)
  const hasInsufficientBalance = parseFloat(dryResult.total) > parseFloat(balance.formattedAmount)
  const { memo: previewMemo, destinationTag: payloadDestinationTag } = getSendPreviewDetails(
    params.chain,
    dryResult.keysignPayload
  )

  // A token send pays its fee out of the NATIVE balance, which `total` no
  // longer covers — so check it separately. Holding the token but no gas is
  // the ordinary way an ERC-20 send fails, and it would otherwise preview
  // clean and only fail at broadcast.
  //
  // Whether this IS a token send is decided by asset identity (`tokenId` is
  // absent on a native balance), never by comparing tickers: an ERC-20 whose
  // symbol happens to be the native ticker would otherwise have its own
  // balance checked for gas it cannot pay. A native send needs no separate
  // check at all — `total` already includes the fee, and running one would
  // just report the same shortfall twice.
  const isTokenSend = balance.tokenId !== undefined
  const feeBalance = isTokenSend ? await vault.balance(params.chain).catch(() => undefined) : undefined

  const warnings: string[] = []
  if (hasInsufficientBalance) {
    warnings.push(`Insufficient balance: you have ${balance.formattedAmount} ${balance.symbol}`)
  }
  if (isTokenSend && feeBalance === undefined) {
    // The gas check needs a second balance read, and it failed. Say so rather
    // than letting its absence read as "gas is fine".
    warnings.push(`Could not check your ${dryResult.feeSymbol} balance for the network fee`)
  } else if (feeBalance && parseFloat(dryResult.fee) > parseFloat(feeBalance.formattedAmount)) {
    warnings.push(
      `Insufficient ${dryResult.feeSymbol} for the network fee: you have ${feeBalance.formattedAmount} ${dryResult.feeSymbol}, the fee is ${dryResult.fee}`
    )
  }

  // bead vultisig-2lnf8: `params.amount` echoes the raw user input verbatim, so
  // `--max` leaked as `amount: 'max'` in the sign-card display even though the
  // SDK already resolved it to (balance - fee) in `amountBigInt` (VaultBase.ts
  // :1750-1754). Rehydrate the display value from what the SDK already gave us —
  // for a token max, `dryResult.total` IS the amount (fee is paid in a different
  // token, isTokenSend branch of VaultBase.ts:1782). For a native max, we
  // subtract via BigInt string arithmetic to avoid float-precision loss at
  // 18-decimal chains: amount = total - fee, both scaled to `decimals` first.
  // Non-max amounts pass through unchanged so any user-typed decimal is preserved.
  //
  // Contrast: swap-quote already exposes the resolved value via a distinct
  // `maxSwapable` field (clients/cli/src/commands/swap.ts). This aligns send's
  // display with that pattern without introducing a new field.
  const amountDisplay =
    params.amount === 'max' ? resolvedMaxAmount(isTokenSend, dryResult.total, dryResult.fee) : params.amount

  // fee/total come straight from the build the SDK just did. They were previously
  // dropped from the JSON result even though the human preview below prints the fee
  // and `total` is what the insufficient-balance check compares against — so
  // `--dry-run -o json` looked like a bare balance check with no cost information.
  const result: SendDryRunResult = {
    dryRun: true,
    chain: params.chain,
    to,
    amount: amountDisplay,
    symbol: balance.symbol,
    fee: dryResult.fee,
    feeSymbol: dryResult.feeSymbol,
    total: dryResult.total,
    balance: balance.formattedAmount,
    destinationTag: payloadDestinationTag,
    ...(previewMemo ? { memo: previewMemo } : {}),
    ...(warnings.length > 0 ? { warning: warnings.join('. ') } : {}),
  }

  if (isJsonOutput()) {
    outputJson(result)
    return result
  }

  info(`\nDry-run preview:`)
  info(`  Chain:   ${result.chain}`)
  info(`  To:      ${result.to}`)
  info(`  Amount:  ${result.amount} ${result.symbol}`)
  if (result.destinationTag !== undefined) info(`  Destination tag: ${result.destinationTag}`)
  if (result.memo) info(`  Memo:    ${escapeTerminalControls(result.memo)}`)
  info(`  Fee:     ${result.fee} ${result.feeSymbol}`)
  info(`  Total:   ${result.total} ${result.symbol}`)
  info(`  Balance: ${result.balance} ${result.symbol}`)
  if (result.warning) warn(`  Warning: ${result.warning}`)
  return result
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
    return previewDryRun(vault, params, dryResult, to)
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
    const preview = getSendPreviewDetails(params.chain, dryResult.keysignPayload)
    displayTransactionPreview(
      address,
      to,
      dryResult.total,
      balance.symbol,
      params.chain,
      preview.memo,
      preview.destinationTag,
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
