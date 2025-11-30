/**
 * Transaction Commands - send transactions
 */
import type { VaultBase } from '@vultisig/sdk/node'
import { Chain, Vultisig } from '@vultisig/sdk/node'

import type { CommandContext, SendParams, TransactionResult } from '../core'
import { confirmTransaction, createSpinner, displayTransactionPreview, displayTransactionResult, warn } from '../ui'

// AccountCoin type from SDK internals
type AccountCoin = {
  chain: Chain
  address: string
  decimals: number
  ticker: string
  id?: string
}

/**
 * Execute send command - send tokens to an address
 */
export async function executeSend(ctx: CommandContext, params: SendParams): Promise<TransactionResult> {
  const vault = await ctx.ensureActiveVault()

  if (!Object.values(Chain).includes(params.chain)) {
    throw new Error(`Invalid chain: ${params.chain}`)
  }

  if (isNaN(parseFloat(params.amount)) || parseFloat(params.amount) <= 0) {
    throw new Error('Invalid amount')
  }

  return sendTransaction(vault, params)
}

/**
 * Send transaction with full flow: prepare -> confirm -> sign -> broadcast
 */
export async function sendTransaction(vault: VaultBase, params: SendParams): Promise<TransactionResult> {
  // 1. Prepare transaction
  const prepareSpinner = createSpinner('Preparing transaction...')

  const address = await vault.address(params.chain)
  const balance = await vault.balance(params.chain, params.tokenId)

  const coin: AccountCoin = {
    chain: params.chain,
    address,
    decimals: balance.decimals,
    ticker: balance.symbol,
    id: params.tokenId,
  }

  const amount = BigInt(Math.floor(parseFloat(params.amount) * Math.pow(10, balance.decimals)))

  const payload = await vault.prepareSendTx({
    coin,
    receiver: params.to,
    amount,
    memo: params.memo,
  })

  prepareSpinner.succeed('Transaction prepared')

  // 2. Get gas estimate
  let gas: Awaited<ReturnType<typeof vault.gas>> | undefined
  try {
    gas = await vault.gas(params.chain)
  } catch {
    warn('\nGas estimation unavailable')
  }

  // 3. Show transaction preview
  displayTransactionPreview(
    payload.coin.address,
    params.to,
    params.amount,
    payload.coin.ticker,
    params.chain,
    params.memo,
    gas
  )

  // 4. Confirm with user
  const confirmed = await confirmTransaction()
  if (!confirmed) {
    warn('Transaction cancelled')
    throw new Error('Transaction cancelled by user')
  }

  // 5. Sign transaction
  const signSpinner = createSpinner('Signing transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  try {
    const messageHashes = await vault.extractMessageHashes(payload)

    const signature = await vault.sign({
      transaction: payload,
      chain: payload.coin.chain,
      messageHashes,
    })

    signSpinner.succeed('Transaction signed')

    // 6. Broadcast transaction
    const broadcastSpinner = createSpinner('Broadcasting transaction...')

    const txHash = await vault.broadcastTx({
      chain: params.chain,
      keysignPayload: payload,
      signature,
    })

    broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`)

    // 7. Display result
    displayTransactionResult(params.chain, txHash)

    return {
      txHash,
      chain: params.chain,
      explorerUrl: Vultisig.getTxExplorerUrl(params.chain, txHash),
    }
  } finally {
    vault.removeAllListeners('signingProgress')
  }
}
