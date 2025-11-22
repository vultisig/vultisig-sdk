import {
  Balance,
  Chain,
  FiatCurrency,
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
        storage: { type: 'node', basePath: this.config.storagePath },
      })

      await this.sdk.initialize()

      // Check if there's an active vault in storage (from previous import/create)
      const existingVault = await this.sdk.getActiveVault()
      if (existingVault) {
        this.activeVault = existingVault
        this.setupVaultEvents(this.activeVault)
        spinner.succeed(`SDK initialized - Vault loaded: ${existingVault.name}`)
        return
      }

      // Auto-import vault from .env if configured and no active vault
      const vaultFilePath = process.env.VAULT_FILE_PATH
      if (vaultFilePath) {
        try {
          // Check if file exists
          await fs.access(vaultFilePath)

          // Read vault file
          const vultContent = await fs.readFile(vaultFilePath, 'utf-8')

          // Import vault with optional password from .env
          const vaultPassword = process.env.VAULT_PASSWORD
          this.activeVault = await this.sdk.importVault(
            vultContent,
            vaultPassword
          )
          this.setupVaultEvents(this.activeVault)
          spinner.succeed(
            `SDK initialized - Vault imported: ${this.activeVault.name}`
          )
          return
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
   * Create new fast vault with progress tracking
   * Returns vaultId for email verification
   */
  async createVault(
    name: string,
    password: string,
    email: string
  ): Promise<{ vaultId: string; verificationRequired: boolean }> {
    const spinner = ora('Creating vault...').start()

    try {
      // Listen for progress events
      const progressHandler = ({ step }: any) => {
        spinner.text = `${step.message} (${step.progress}%)`
      }
      this.sdk.on('vaultCreationProgress', progressHandler)

      // Create fast vault (2-of-2 with VultiServer)
      const result = await this.sdk.createFastVault({
        name,
        password,
        email,
      })

      // Clean up progress listener
      this.sdk.off('vaultCreationProgress', progressHandler)

      this.activeVault = result.vault
      this.setupVaultEvents(this.activeVault)
      spinner.succeed(`Vault created: ${name}`)

      return {
        vaultId: result.vaultId,
        verificationRequired: result.verificationRequired,
      }
    } catch (error) {
      spinner.fail('Vault creation failed')
      throw error
    }
  }

  /**
   * Verify vault with email code
   * Call this after creating a fast vault to verify email delivery
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    const spinner = ora('Verifying email code...').start()

    try {
      const verified = await this.sdk.verifyVault(vaultId, code)

      if (verified) {
        spinner.succeed('Email verified successfully!')
        return true
      } else {
        spinner.fail('Invalid verification code')
        return false
      }
    } catch (error) {
      spinner.fail('Verification failed')
      throw error
    }
  }

  /**
   * Resend verification email
   */
  async resendVerification(vaultId: string): Promise<void> {
    const spinner = ora('Resending verification email...').start()

    try {
      await this.sdk.serverManager.resendVaultVerification(vaultId)
      spinner.succeed('Verification email sent!')
    } catch (error) {
      spinner.fail('Failed to resend verification email')
      throw error
    }
  }

  /**
   * Import vault from file
   */
  async importVault(filePath: string, password?: string): Promise<Vault> {
    const spinner = ora('Importing vault...').start()

    try {
      // Read vault file content
      const vultContent = await fs.readFile(filePath, 'utf-8')

      // Import vault using SDK
      const vault = await this.sdk.importVault(vultContent, password)

      this.activeVault = vault
      this.setupVaultEvents(this.activeVault)
      spinner.succeed(`Vault imported: ${vault.name}`)

      return vault
    } catch (error: any) {
      spinner.fail('Import failed')
      throw error
    }
  }

  /**
   * Export vault to file
   */
  async exportVault(outputPath?: string, _password?: string): Promise<string> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    const spinner = ora('Exporting vault...').start()

    try {
      // Export vault using Vault instance method
      const { data: vultContent } = await this.activeVault.export()

      // Determine output filename
      const fileName =
        outputPath ||
        `${this.activeVault.name}-${this.activeVault.localPartyId}-vault.vult`

      // Write to file
      await fs.writeFile(fileName, vultContent, 'utf-8')

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
   * Lock vault (clear cached password/keyShares)
   */
  lockVault(): void {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    this.activeVault.lock()
    console.log(chalk.green('✓ Vault locked'))
  }

  /**
   * Unlock vault with password (cache for TTL duration)
   */
  async unlockVault(password: string): Promise<void> {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    const spinner = ora('Unlocking vault...').start()

    try {
      await this.activeVault.unlock(password)
      const ttlRemaining = this.activeVault.getUnlockTimeRemaining()
      const minutes = Math.floor(ttlRemaining / 60000)
      const seconds = Math.floor((ttlRemaining % 60000) / 1000)
      spinner.succeed(`Vault unlocked (valid for ${minutes}m ${seconds}s)`)
    } catch (error) {
      spinner.fail('Failed to unlock vault')
      throw error
    }
  }

  /**
   * Check if vault is unlocked and get remaining time
   */
  getVaultStatus(): {
    isUnlocked: boolean
    timeRemaining?: number
    timeRemainingFormatted?: string
  } {
    if (!this.activeVault) {
      throw new Error('No active vault')
    }

    const isUnlocked = this.activeVault.isUnlocked()
    if (!isUnlocked) {
      return { isUnlocked: false }
    }

    const timeRemaining = this.activeVault.getUnlockTimeRemaining()
    const minutes = Math.floor(timeRemaining / 60000)
    const seconds = Math.floor((timeRemaining % 60000) / 1000)

    return {
      isUnlocked: true,
      timeRemaining,
      timeRemainingFormatted: `${minutes}m ${seconds}s`,
    }
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
