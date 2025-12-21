/**
 * Transaction Commands - send transactions
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain, Vultisig } from '@vultisig/sdk'
import qrcode from 'qrcode-terminal'

import type { CommandContext, SendParams, TransactionResult } from '../core'
import { ensureVaultUnlocked } from '../core'
import { createSpinner, info, isJsonOutput, isSilent, outputJson, printResult, warn } from '../lib/output'
import { confirmTransaction, displayTransactionPreview, displayTransactionResult } from '../ui'

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

  // 3. Show transaction preview (skip in JSON mode)
  if (!isJsonOutput()) {
    displayTransactionPreview(
      payload.coin.address,
      params.to,
      params.amount,
      payload.coin.ticker,
      params.chain,
      params.memo,
      gas
    )
  }

  // 4. Confirm with user (skip if --yes flag is set or JSON mode)
  if (!params.yes && !isJsonOutput()) {
    const confirmed = await confirmTransaction()
    if (!confirmed) {
      warn('Transaction cancelled')
      throw new Error('Transaction cancelled by user')
    }
  }

  // Pre-unlock vault before signing to avoid password prompt interference with spinner
  await ensureVaultUnlocked(vault, params.password)

  // 5. Sign transaction
  const isSecureVault = vault.type === 'secure'
  const signSpinner = createSpinner(isSecureVault ? 'Preparing secure signing session...' : 'Signing transaction...')

  vault.on('signingProgress', ({ step }: any) => {
    signSpinner.text = `${step.message} (${step.progress}%)`
  })

  // For secure vaults, handle QR code display and device joining
  if (isSecureVault) {
    vault.on('qrCodeReady', ({ qrPayload }: { qrPayload: string }) => {
      if (isJsonOutput()) {
        // JSON mode: Print QR URL immediately for scripting
        printResult(qrPayload)
      } else if (isSilent()) {
        // Silent mode: Print URL only
        printResult(`QR Payload: ${qrPayload}`)
      } else {
        // Interactive: Display ASCII QR code
        signSpinner.stop()
        info('\nScan this QR code with your Vultisig mobile app to sign:')
        qrcode.generate(qrPayload, { small: true })
        info(`\nOr use this URL: ${qrPayload}\n`)
        signSpinner.start('Waiting for devices to join signing session...')
      }
    })

    vault.on(
      'deviceJoined',
      ({ deviceId, totalJoined, required }: { deviceId: string; totalJoined: number; required: number }) => {
        if (!isSilent()) {
          signSpinner.text = `Device joined: ${totalJoined}/${required} (${deviceId})`
        } else if (!isJsonOutput()) {
          printResult(`Device joined: ${totalJoined}/${required}`)
        }
      }
    )
  }

  try {
    const messageHashes = await vault.extractMessageHashes(payload)

    const signature = await vault.sign(
      {
        transaction: payload,
        chain: payload.coin.chain,
        messageHashes,
      },
      { signal: params.signal }
    )

    signSpinner.succeed('Transaction signed')

    // 6. Broadcast transaction
    const broadcastSpinner = createSpinner('Broadcasting transaction...')

    const txHash = await vault.broadcastTx({
      chain: params.chain,
      keysignPayload: payload,
      signature,
    })

    broadcastSpinner.succeed(`Transaction broadcast: ${txHash}`)

    const result: TransactionResult = {
      txHash,
      chain: params.chain,
      explorerUrl: Vultisig.getTxExplorerUrl(params.chain, txHash),
    }

    // 7. Display result
    if (isJsonOutput()) {
      outputJson(result)
    } else {
      displayTransactionResult(params.chain, txHash)
    }

    return result
  } finally {
    vault.removeAllListeners('signingProgress')
    if (isSecureVault) {
      vault.removeAllListeners('qrCodeReady')
      vault.removeAllListeners('deviceJoined')
    }
  }
}
