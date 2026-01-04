/**
 * Broadcast Command - Broadcast pre-signed raw transactions
 *
 * Used for broadcasting transactions that were signed externally or assembled
 * from signatures obtained via the `sign` command.
 */
import { Chain, Vultisig } from '@vultisig/sdk'

import type { CommandContext } from '../core'
import { createSpinner, isJsonOutput, outputJson, printResult } from '../lib/output'

/**
 * Parameters for broadcasting a raw transaction
 */
export type BroadcastRawParams = {
  chain: Chain
  rawTx: string // Hex-encoded signed transaction
}

/**
 * Result of broadcast operation
 */
export type BroadcastRawResult = {
  txHash: string
  chain: Chain
  explorerUrl: string
}

/**
 * Execute broadcast command - broadcast pre-signed raw transaction
 */
export async function executeBroadcast(ctx: CommandContext, params: BroadcastRawParams): Promise<BroadcastRawResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new Error(`Invalid chain: ${params.chain}`)
  }

  const broadcastSpinner = createSpinner('Broadcasting transaction...')

  try {
    const txHash = await vault.broadcastRawTx({
      chain: params.chain,
      rawTx: params.rawTx,
    })

    broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`)

    const result: BroadcastRawResult = {
      txHash,
      chain: params.chain,
      explorerUrl: Vultisig.getTxExplorerUrl(params.chain, txHash),
    }

    if (isJsonOutput()) {
      outputJson(result)
    } else {
      printResult(`TX Hash: ${result.txHash}`)
      printResult(`Explorer: ${result.explorerUrl}`)
    }

    return result
  } catch (error) {
    broadcastSpinner.fail('Broadcast failed')
    throw error
  }
}
