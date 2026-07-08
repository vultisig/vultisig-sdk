/**
 * Transaction Status Command - Check if a transaction has confirmed
 *
 * By default, polls every 5 seconds until the transaction reaches a final state
 * (success or error) OR the total wait budget (`--timeout`, default 120s) is
 * spent. Use --no-wait to return the current status immediately.
 *
 * The `--tx-hash` value is validated for its chain-kind BEFORE any RPC call, so a
 * malformed hash fails fast with INVALID_INPUT (exit 4) instead of being polled.
 * A well-formed hash the node has never seen resolves to `not_found` rather than
 * an indefinite `pending`, so a typo'd or dropped hash can never poll forever.
 */
import type { TxStatusResult } from '@vultisig/sdk'
import { Chain, isValidTxHash, Vultisig } from '@vultisig/sdk'

import type { CommandContext } from '../core'
import { InvalidInputError, TxNotFoundError, TxStatusTimeoutError } from '../core'
import { createSpinner, isJsonOutput, outputJson, printResult } from '../lib/output'

export type TxStatusParams = {
  chain: Chain
  txHash: string
  noWait?: boolean
  /** Total wait budget in seconds for polling mode. Ignored when `noWait`. */
  timeoutSec?: number
}

const POLL_INTERVAL_MS = 5_000
const DEFAULT_TIMEOUT_SEC = 120

// Statuses that end the poll. `not_found` is terminal here too: if the node has
// never seen the hash we surface that immediately rather than waiting it out
// (a freshly-broadcast tx briefly reading `not_found` is covered by the timeout).
const isTerminal = (status: TxStatusResult['status']): boolean => status === 'success' || status === 'error'

export async function executeTxStatus(
  ctx: CommandContext,
  params: TxStatusParams,
  opts: { pollIntervalMs?: number } = {}
): Promise<TxStatusResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new InvalidInputError(`Invalid chain: ${params.chain}`)
  }

  // Validate the hash shape BEFORE touching the network — a malformed hash is a
  // user error, not something to poll. (exit 4 / INVALID_INPUT, no RPC.)
  if (!isValidTxHash(params.chain, params.txHash)) {
    throw new InvalidInputError(
      `Invalid transaction hash for ${params.chain}: "${params.txHash}"`,
      'Check the hash — it must match the expected format for the chain.',
      undefined,
      { chain: params.chain, txHash: params.txHash }
    )
  }

  const pollIntervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS
  const spinner = createSpinner('Checking transaction status...')

  try {
    let result = await vault.getTxStatus({ chain: params.chain, txHash: params.txHash })

    if (!params.noWait && !isTerminal(result.status)) {
      const timeoutMs = Math.max(0, (params.timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000)
      const deadline = Date.now() + timeoutMs
      let waited = 0

      while (!isTerminal(result.status)) {
        if (Date.now() >= deadline) {
          spinner.fail(`Gave up waiting after ${Math.round(waited / 1000)}s (status: ${result.status})`)
          throw giveUpError(params, result, waited)
        }
        waited += pollIntervalMs
        spinner.text = `Transaction ${result.status}... (${Math.round(waited / 1000)}s)`
        await sleep(pollIntervalMs)
        result = await vault.getTxStatus({ chain: params.chain, txHash: params.txHash })
      }
    }

    spinner.succeed(`Transaction status: ${result.status}`)
    displayResult(params.chain, params.txHash, result)
    return result
  } catch (error) {
    if (error instanceof TxNotFoundError || error instanceof TxStatusTimeoutError) {
      // Spinner already resolved above; surface the structured error as-is.
      throw error
    }
    spinner.fail('Failed to check transaction status')
    throw error
  }
}

function giveUpError(
  params: TxStatusParams,
  result: TxStatusResult,
  waitedMs: number
): TxNotFoundError | TxStatusTimeoutError {
  const seconds = Math.round(waitedMs / 1000)
  const context = { chain: params.chain, txHash: params.txHash, status: result.status }

  if (result.status === 'not_found') {
    return new TxNotFoundError(
      `Transaction not found on ${params.chain} after ${seconds}s: ${params.txHash}`,
      'The node has no record of this hash — it may have been dropped, replaced, or never broadcast.',
      ['Verify the transaction hash', 'Re-broadcast if it was never sent'],
      context
    )
  }

  return new TxStatusTimeoutError(
    `Transaction still ${result.status} on ${params.chain} after ${seconds}s: ${params.txHash}`,
    'The transaction may still confirm later.',
    ['Re-run to keep checking', 'Increase the wait budget with --timeout <seconds>'],
    context
  )
}

function displayResult(chain: Chain, txHash: string, result: TxStatusResult): void {
  if (isJsonOutput()) {
    outputJson({
      chain,
      txHash,
      status: result.status,
      receipt: result.receipt
        ? {
            feeAmount: result.receipt.feeAmount.toString(),
            feeDecimals: result.receipt.feeDecimals,
            feeTicker: result.receipt.feeTicker,
          }
        : undefined,
      explorerUrl: Vultisig.getTxExplorerUrl(chain, txHash),
    })
  } else {
    printResult(`Status: ${result.status}`)
    if (result.receipt) {
      const fee = formatFee(result.receipt.feeAmount, result.receipt.feeDecimals)
      printResult(`Fee: ${fee} ${result.receipt.feeTicker}`)
    }
    printResult(`Explorer: ${Vultisig.getTxExplorerUrl(chain, txHash)}`)
  }
}

function formatFee(amount: bigint, decimals: number): string {
  const str = amount.toString().padStart(decimals + 1, '0')
  const whole = str.slice(0, -decimals) || '0'
  const frac = str.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
