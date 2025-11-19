import {
  Balance,
  Chain,
  FiatCurrency,
  NodeStorage,
  Token,
  Vault,
  Vultisig,
} from '@vultisig/sdk'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import ora from 'ora'

import type { PortfolioSummary, WalletConfig } from './types'

/**
 * VaultManager - High-level vault management and operations
 *
 * Provides a user-friendly wrapper around the Vultisig SDK with:
 * - Progress spinners for async operations
 * - Color-coded success/error messages
 * - Event handling with automatic cleanup
 * - Error handling with descriptive messages
 */
export class VaultManager {
  private sdk!: Vultisig
  private activeVault: Vault | null = null
  private config: WalletConfig

  constructor(config?: WalletConfig) {
    this.config = {
      storagePath: process.env.VAULT_STORAGE_PATH || './vaults',
      defaultCurrency: process.env.DEFAULT_CURRENCY || 'usd',
      ...config,
    }
  }

  /**
   * Initialize SDK with NodeStorage
   */
  async initialize(): Promise<void> {
    const spinner = ora('Initializing Vultisig SDK...').start()

    try {
      this.sdk = new Vultisig({
        storage: new NodeStorage(this.config.storagePath),
        serverEndpoints: {
          fastVault: this.config.serverUrl,
          messageRelay: this.config.relayUrl,
        },
        autoInit: true,
        defaultCurrency: this.config.defaultCurrency,
      })

      await this.sdk.initialize()

      // Auto-import vault from .env if configured
      const vaultFilePath = process.env.VAULT_FILE_PATH
      if (vaultFilePath) {
        try {
          // Check if file exists
          await fs.access(vaultFilePath)

          // Import vault with optional password from .env
          const vaultPassword = process.env.VAULT_PASSWORD
          this.activeVault = await this.sdk.addVaultFromFile(
            vaultFilePath,
            vaultPassword
          )
          this.setupVaultEvents(this.activeVault)
          spinner.text = `Vault loaded: ${this.activeVault.data.name}`
        } catch (error: any) {
          // If vault file doesn't exist or import fails, continue without it
          if (error.code !== 'ENOENT') {
            spinner.warn(`Failed to auto-import vault: ${error.message}`)
          }
        }
      }

      spinner.succeed('SDK initialized')
    } catch (error) {
      spinner.fail('SDK initialization failed')
      throw error
    }
  }

  /**
   * Create new vault with progress tracking
   */
  async createVault(
    name: string,
    password: string,
    email: string
  ): Promise<{ vault: Vault; vaultId: string; verificationRequired: boolean }> {
    const spinner = ora('Creating vault...').start()

    // Setup progress tracking
    this.sdk.on('vaultCreationProgress', ({ step }: any) => {
      spinner.text = `${step.message} (${step.progress}%)`
    })

    try {
      const result = await this.sdk.createFastVault({
        name,
        password,
        email,
      })

      this.activeVault = result.vault
      this.setupVaultEvents(this.activeVault)
      spinner.succeed(`Vault created: ${name}`)

      return result
    } catch (error) {
      spinner.fail('Vault creation failed')
      throw error
    } finally {
      this.sdk.removeAllListeners('vaultCreationProgress')
    }
  }

  /**
   * Verify vault with email code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    const spinner = ora('Verifying email...').start()

    try {
      const verified = await this.sdk.verifyVault(vaultId, code)

      if (verified) {
        spinner.succeed('Vault verified')
      } else {
        spinner.fail('Verification failed')
      }

      return verified
    } catch (error) {
      spinner.fail('Verification error')
      throw error
    }
  }

  /**
   * Import vault from file
   */
  async importVault(filePath: string, password?: string): Promise<Vault> {
    const spinner = ora('Importing vault...').start()

    try {
      // Use SDK's built-in addVaultFromFile method
      const vault = await this.sdk.addVaultFromFile(filePath, password)

      this.activeVault = vault
      this.setupVaultEvents(this.activeVault)
      spinner.succeed(`Vault imported: ${vault.data.name}`)

      return vault
    } catch (error: any) {
      spinner.fail('Import failed')
      throw error
    }
  }

  /**
   * Export vault to file
   */
  async exportVault(outputPath?: string, password?: string): Promise<string> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    const spinner = ora('Exporting vault...').start()

    try {
      const blob = await this.activeVault.export(password)
      const buffer = await blob.arrayBuffer()

      const fileName = outputPath || this.activeVault.getExportFileName()
      await fs.writeFile(fileName, Buffer.from(buffer))

      spinner.succeed(`Vault exported: ${fileName}`)
      return fileName
    } catch (error) {
      spinner.fail('Export failed')
      throw error
    }
  }

  /**
   * Get active vault
   */
  getActiveVault(): Vault | null {
    return this.activeVault
  }

  /**
   * Get balance for a chain
   */
  async getBalance(chain: Chain, tokenId?: string): Promise<Balance> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    return await this.activeVault.balance(chain, tokenId)
  }

  /**
   * Get balances for all chains
   */
  async getAllBalances(
    includeTokens = false
  ): Promise<Record<string, Balance>> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    return await this.activeVault.balances(undefined, includeTokens)
  }

  /**
   * Get portfolio value across all chains
   */
  async getPortfolioValue(
    currency: FiatCurrency = 'usd'
  ): Promise<PortfolioSummary> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    const totalValue = await this.activeVault.getTotalValue(currency)
    const chains = this.activeVault.getChains()

    const chainBalances = await Promise.all(
      chains.map(async chain => {
        const balance = await this.activeVault!.balance(chain)
        try {
          const value = await this.activeVault!.getValue(
            chain,
            undefined,
            currency
          )
          return { chain, balance, value }
        } catch {
          // Fiat value might not be available for all chains
          return { chain, balance }
        }
      })
    )

    return { totalValue, chainBalances }
  }

  /**
   * Add chain to vault
   */
  async addChain(chain: Chain): Promise<void> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    await this.activeVault.addChain(chain)
    console.log(chalk.green(`✓ Added chain: ${chain}`))
  }

  /**
   * Remove chain from vault
   */
  async removeChain(chain: Chain): Promise<void> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    await this.activeVault.removeChain(chain)
    console.log(chalk.green(`✓ Removed chain: ${chain}`))
  }

  /**
   * Add token to chain
   */
  async addToken(chain: Chain, token: Token): Promise<void> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    await this.activeVault.addToken(chain, token)
    console.log(chalk.green(`✓ Added token: ${token.symbol} on ${chain}`))
  }

  /**
   * Remove token from chain
   */
  async removeToken(chain: Chain, tokenId: string): Promise<void> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    await this.activeVault.removeToken(chain, tokenId)
    console.log(chalk.green(`✓ Removed token: ${tokenId}`))
  }

  /**
   * Get all addresses for the vault
   */
  async getAddresses(): Promise<Record<string, string>> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    return await this.activeVault.addresses()
  }

  /**
   * Setup event listeners for vault
   */
  private setupVaultEvents(vault: Vault): void {
    // Balance updates
    vault.on('balanceUpdated', ({ chain, balance, tokenId }: any) => {
      const asset = tokenId ? `${balance.symbol} token` : balance.symbol
      console.log(
        chalk.blue(
          `ℹ Balance updated for ${chain} (${asset}): ${balance.amount}`
        )
      )
    })

    // Transaction broadcast
    vault.on('transactionBroadcast', ({ chain, txHash }: any) => {
      console.log(chalk.green(`✓ Transaction broadcast on ${chain}`))
      console.log(chalk.blue(`  TX Hash: ${txHash}`))
    })

    // Chain added
    vault.on('chainAdded', ({ chain }: any) => {
      console.log(chalk.green(`✓ Chain added: ${chain}`))
    })

    // Chain removed
    vault.on('chainRemoved', ({ chain }: any) => {
      console.log(chalk.yellow(`ℹ Chain removed: ${chain}`))
    })

    // Token added
    vault.on('tokenAdded', ({ chain, token }: any) => {
      console.log(chalk.green(`✓ Token added: ${token.symbol} on ${chain}`))
    })

    // Values updated
    vault.on('valuesUpdated', ({ chain }: any) => {
      if (chain === 'all') {
        console.log(chalk.blue('ℹ Portfolio values updated'))
      } else {
        console.log(chalk.blue(`ℹ Values updated for ${chain}`))
      }
    })

    // Errors
    vault.on('error', (error: any) => {
      console.error(chalk.red(`✗ Vault error: ${error.message}`))
    })
  }
}
