import { Chain, GasInfo, Signature, Vault } from '@vultisig/sdk'
import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'

import type { KeysignPayload, SendParams, TransactionResult } from './types'

// AccountCoin type from SDK internals
type AccountCoin = {
  chain: Chain
  address: string
  decimals: number
  ticker: string
  id?: string
}

/**
 * TransactionManager - Transaction preparation, signing, and broadcasting
 *
 * Handles the complete transaction lifecycle:
 * - Prepare transaction payload
 * - Sign transaction with progress tracking
 * - Broadcast transaction to blockchain
 * - Generate explorer URLs
 */
export class TransactionManager {
  constructor(private vault: Vault) {}

  /**
   * Estimate gas for a chain
   */
  async estimateGas(chain: Chain): Promise<GasInfo> {
    return await this.vault.gas(chain)
  }

  /**
   * Prepare transaction payload
   */
  async prepareSend(params: SendParams): Promise<KeysignPayload> {
    const spinner = ora('Preparing transaction...').start()

    try {
      // Get chain address and info
      const address = await this.vault.address(params.chain)
      const balance = await this.vault.balance(params.chain, params.tokenId)

      // Build coin info
      const coin: AccountCoin = {
        chain: params.chain,
        address,
        decimals: balance.decimals,
        ticker: balance.symbol,
        id: params.tokenId,
      }

      // Convert human-readable amount to bigint
      const amount = BigInt(
        Math.floor(parseFloat(params.amount) * Math.pow(10, balance.decimals))
      )

      // Prepare transaction
      const payload = await this.vault.prepareSendTx({
        coin,
        receiver: params.to,
        amount,
        memo: params.memo,
      })

      spinner.succeed('Transaction prepared')
      return payload
    } catch (error) {
      spinner.fail('Failed to prepare transaction')
      throw error
    }
  }

  /**
   * Sign transaction with progress tracking
   */
  async signTransaction(
    payload: KeysignPayload,
    password?: string
  ): Promise<Signature> {
    const spinner = ora('Signing transaction...').start()

    // Setup progress tracking
    this.vault.on('signingProgress', ({ step }: any) => {
      spinner.text = `${step.message} (${step.progress}%)`
    })

    try {
      const messageHashes = await this.vault.extractMessageHashes(payload)

      const signature = await this.vault.sign(
        'fast',
        {
          transaction: payload,
          chain: payload.coin.chain,
          messageHashes,
        },
        password
      )

      spinner.succeed('Transaction signed')
      return signature
    } catch (error) {
      spinner.fail('Signing failed')
      throw error
    } finally {
      this.vault.removeAllListeners('signingProgress')
    }
  }

  /**
   * Broadcast signed transaction
   */
  async broadcastTransaction(
    chain: Chain,
    payload: KeysignPayload,
    signature: Signature
  ): Promise<string> {
    const spinner = ora('Broadcasting transaction...').start()

    try {
      const txHash = await this.vault.broadcastTx({
        chain,
        keysignPayload: payload,
        signature,
      })

      spinner.succeed(`Transaction broadcast: ${txHash}`)
      return txHash
    } catch (error) {
      spinner.fail('Broadcast failed')
      throw error
    }
  }

  /**
   * Complete send flow: prepare → confirm → sign → broadcast
   */
  async send(
    params: SendParams,
    password?: string
  ): Promise<TransactionResult> {
    // 1. Prepare transaction
    const payload = await this.prepareSend(params)

    // 2. Get gas estimate
    try {
      const gas = await this.estimateGas(params.chain)
      console.log(
        chalk.blue(`\nEstimated gas: ${JSON.stringify(gas, null, 2)}`)
      )
    } catch {
      console.log(chalk.yellow('\nGas estimation unavailable'))
    }

    // 3. Show transaction preview
    console.log(chalk.cyan('\nTransaction Preview:'))
    console.log(`  From:   ${payload.coin.address}`)
    console.log(`  To:     ${params.to}`)
    console.log(`  Amount: ${params.amount} ${payload.coin.ticker}`)
    console.log(`  Chain:  ${params.chain}`)
    if (params.memo) {
      console.log(`  Memo:   ${params.memo}`)
    }

    // 4. Confirm with user
    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message: 'Proceed with this transaction?',
        default: false,
      },
    ])

    if (!confirmed) {
      console.log(chalk.yellow('Transaction cancelled'))
      throw new Error('Transaction cancelled by user')
    }

    // 5. Sign transaction
    const signature = await this.signTransaction(payload, password)

    // 6. Broadcast transaction
    const txHash = await this.broadcastTransaction(
      params.chain,
      payload,
      signature
    )

    // 7. Return result with explorer URL
    const explorerUrl = this.formatTxExplorerUrl(params.chain, txHash)

    return {
      txHash,
      chain: params.chain,
      explorerUrl,
    }
  }

  /**
   * Format explorer URL for transaction
   */
  formatTxExplorerUrl(chain: Chain, txHash: string): string {
    const explorers: Record<string, string> = {
      [Chain.Ethereum]: `https://etherscan.io/tx/${txHash}`,
      [Chain.Polygon]: `https://polygonscan.com/tx/${txHash}`,
      [Chain.Bitcoin]: `https://blockchair.com/bitcoin/transaction/${txHash}`,
      [Chain.Arbitrum]: `https://arbiscan.io/tx/${txHash}`,
      [Chain.Optimism]: `https://optimistic.etherscan.io/tx/${txHash}`,
      [Chain.Base]: `https://basescan.org/tx/${txHash}`,
      [Chain.BscChain]: `https://bscscan.com/tx/${txHash}`,
      [Chain.Avalanche]: `https://snowtrace.io/tx/${txHash}`,
      [Chain.Blast]: `https://blastscan.io/tx/${txHash}`,
      [Chain.CronosChain]: `https://cronoscan.com/tx/${txHash}`,
      [Chain.Solana]: `https://solscan.io/tx/${txHash}`,
      [Chain.Doge]: `https://blockchair.com/dogecoin/transaction/${txHash}`,
      [Chain.Litecoin]: `https://blockchair.com/litecoin/transaction/${txHash}`,
      [Chain.BitcoinCash]: `https://blockchair.com/bitcoin-cash/transaction/${txHash}`,
    }

    return explorers[chain] || `Transaction Hash: ${txHash}`
  }
}
