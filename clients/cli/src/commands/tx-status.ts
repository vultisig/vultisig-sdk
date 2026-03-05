/**
 * Transaction Status Command - Check if a transaction has confirmed
 *
 * By default, polls every 5 seconds until the transaction reaches a final state
 * (success or error). Use --no-wait to return the current status immediately.
 */
import type { TxStatusResult } from '@vultisig/sdk'
import { Chain, Vultisig } from '@vultisig/sdk'

import type { CommandContext } from '../core'
import { createSpinner, isJsonOutput, outputJson, printResult } from '../lib/output'

export type TxStatusParams = {
  chain: Chain
  txHash: string
  noWait?: boolean
}

const POLL_INTERVAL_MS = 5_000

export async function executeTxStatus(ctx: CommandContext, params: TxStatusParams): Promise<TxStatusResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new Error(`Invalid chain: ${params.chain}`)
  }

  const spinner = createSpinner('Checking transaction status...')

  try {
    let result = await vault.getTxStatus({ chain: params.chain, txHash: params.txHash })

    if (!params.noWait) {
      let polls = 1
      while (result.status === 'pending') {
        spinner.text = `Transaction pending... (${polls * 5}s)`
        await sleep(POLL_INTERVAL_MS)
        result = await vault.getTxStatus({ chain: params.chain, txHash: params.txHash })
        polls++
      }
    }

    spinner.succeed(`Transaction status: ${result.status}`)
    displayResult(params.chain, params.txHash, result)
    return result
  } catch (error) {
    spinner.fail('Failed to check transaction status')
    throw error
  }
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
