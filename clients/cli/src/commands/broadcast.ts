/**
 * Broadcast Command - Broadcast pre-signed raw transactions
 *
 * Used for broadcasting transactions that were signed externally or assembled
 * from signatures obtained via the `sign` command.
 */
import { Chain, Vultisig } from '@vultisig/sdk'

import type { CommandContext } from '../core'
import { ConfirmationRequiredError, InvalidInputError } from '../core/errors'
import { createSpinner, isNonInteractive, isJsonOutput, outputJson, printResult, warn } from '../lib/output'
import { confirmTransaction } from '../ui'

/**
 * Parameters for broadcasting a raw transaction
 */
export type BroadcastRawParams = {
  chain: Chain
  rawTx: string // Hex-encoded signed transaction
  /**
   * Skip the interactive confirmation prompt. Required in non-interactive
   * contexts because broadcastRawTx sends the pre-signed payload straight
   * to the chain — a shell injection reaching --raw-tx would move funds.
   * bead vultisig-aq5ku.
   */
  yes?: boolean
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

  // bead vultisig-z3xkg: pre-validate the raw-tx shape locally instead of
  // letting an empty / whitespace / non-hex string reach the RPC and get
  // misclassified as EXTERNAL_SERVICE (retryable:true, suggests "Retry the
  // transaction" — which loops the same bad input forever).
  const rawTx = params.rawTx?.trim() ?? ''
  const hex = rawTx.startsWith('0x') ? rawTx.slice(2) : rawTx
  if (hex.length === 0) {
    throw new InvalidInputError('Empty raw transaction — pass a hex-encoded signed tx via --raw-tx')
  }
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new InvalidInputError(`Malformed raw transaction — expected hex bytes, got: ${rawTx.slice(0, 20)}${rawTx.length > 20 ? '…' : ''}`)
  }

  // bead vultisig-aq5ku: broadcastRawTx moves funds immediately with no
  // interaction. send and sign both have --yes gates; broadcast now does
  // the same. A shell injection or script bug reaching --raw-tx cannot
  // silently broadcast without confirmation.
  if (!params.yes) {
    if (isNonInteractive()) {
      throw new ConfirmationRequiredError(
        'broadcast requires confirmation.',
        'Pass --yes to confirm. broadcastRawTx sends the payload straight to the chain; be sure the raw tx is what you intend to send.'
      )
    }
    warn('\n⚠  You are about to broadcast a pre-signed transaction.')
    warn(`   Chain:  ${params.chain}`)
    warn(`   Raw tx: 0x${hex.slice(0, 20)}…${hex.slice(-20)} (${Math.floor(hex.length / 2)} bytes)`)
    warn(`   This is IRREVERSIBLE. If the payload is a valid signed transaction, funds WILL move.\n`)
    const confirmed = await confirmTransaction()
    if (!confirmed) {
      throw new ConfirmationRequiredError('Broadcast declined at the confirmation prompt')
    }
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
