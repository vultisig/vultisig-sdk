import * as fs from 'fs'
import * as path from 'path'

// SDK will be made available globally by the launcher
declare const VultisigSDK: any
import { DaemonManager } from '../daemon/DaemonManager'
import { getVaultConfig } from '../utils/env'

export type BalanceOptions = {
  network?: string
  vault?: string
  password?: string
}

export class BalanceCommand {
  readonly description = 'Show wallet balances for supported networks'

  async run(options: BalanceOptions): Promise<void> {
    console.log('💰 Querying balances...')

    // Parse requested networks
    const networks = options.network || 'all'
    const requestedChains = this.parseNetworks(networks)

    // Get vault configuration with automatic fallback logic
    const vaultConfig = getVaultConfig(options.vault, options.password)

    // Check if daemon is running or if we need to load vault directly
    const daemonManager = new DaemonManager()
    let shouldLoadDirectly = false

    if (vaultConfig.vaultName || vaultConfig.vaultPassword) {
      shouldLoadDirectly = await daemonManager.autoStartDaemonIfNeeded({
        vault: vaultConfig.vaultName,
        password: vaultConfig.vaultPassword,
      })
    }

    // If daemon is running, get balances from it
    if (!shouldLoadDirectly) {
      try {
        const balances = await daemonManager.balances(requestedChains)

        console.log('\n=== Balances (from daemon) ===')
        for (const [chainKey, balance] of Object.entries(balances)) {
          const chainName = this.getChainName(chainKey)
          if (typeof balance === 'string' && balance.startsWith('Error:')) {
            console.log(`  ❌ ${chainName}: ${balance}`)
          } else if (typeof balance === 'object' && balance !== null) {
            const balanceObj = balance as {
              amount: string
              decimals: number
              symbol: string
            }
            const amount = this.formatAmount(balanceObj.amount, balanceObj.decimals)
            console.log(`  💰 ${chainName}: ${amount} ${balanceObj.symbol}`)
          } else {
            console.log(`  ❓ ${chainName}: Unknown balance format`)
          }
        }

        console.log('\n💡 Balances retrieved from running daemon')
        return
      } catch {
        // Daemon not running, continue to direct vault loading
        shouldLoadDirectly = true
      }
    }

    // Load vault directly for this operation
    if (shouldLoadDirectly && (vaultConfig.vaultName || vaultConfig.vaultPassword)) {
      try {
        await daemonManager.performEphemeralOperation(
          {
            vault: vaultConfig.vaultName,
            password: vaultConfig.vaultPassword,
          },
          async vault => {
            console.log('\n=== Balances (ephemeral vault) ===')

            if (requestedChains.length === 1) {
              // Single chain - use balance() method
              const chain = requestedChains[0]
              try {
                const balance = await vault.balance(chain)
                const chainName = this.getChainName(chain)
                const amount = this.formatAmount(balance.amount, balance.decimals)
                console.log(`  💰 ${chainName}: ${amount} ${balance.symbol}`)
              } catch (error) {
                const chainName = this.getChainName(chain)
                console.log(`  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : 'Unknown error'}`)
              }
            } else {
              // Multiple chains - use balances() method
              try {
                const balances = await vault.balances(requestedChains)
                for (const [chain, balance] of Object.entries(balances)) {
                  const chainName = this.getChainName(chain)
                  const balanceObj = balance as {
                    amount: string
                    decimals: number
                    symbol: string
                  }
                  const amount = this.formatAmount(balanceObj.amount, balanceObj.decimals)
                  console.log(`  💰 ${chainName}: ${amount} ${balanceObj.symbol}`)
                }
              } catch (error) {
                console.log(`  ❌ Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`)
              }
            }

            console.log('\n💡 Balances retrieved from ephemeral vault operation')
            return true
          }
        )
        return
      } catch (error) {
        console.log('⚠️  Could not perform ephemeral vault operation:', error instanceof Error ? error.message : error)
      }
    }

    // Try to use Vultisig SDK to get active vault
    try {
      const sdk = new VultisigSDK()
      const activeVault = sdk.getActiveVault()

      if (activeVault) {
        console.log('\n=== Balances (from active vault) ===')

        if (requestedChains.length === 1) {
          // Single chain - use balance() method
          const chain = requestedChains[0]
          try {
            const balance = await activeVault.balance(chain)
            const chainName = this.getChainName(chain)
            const amount = this.formatAmount(balance.amount, balance.decimals)
            console.log(`  💰 ${chainName}: ${amount} ${balance.symbol}`)
          } catch (error) {
            const chainName = this.getChainName(chain)
            console.log(`  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        } else {
          // Multiple chains - use balances() method
          try {
            const balances = await activeVault.balances(requestedChains)
            for (const [chain, balance] of Object.entries(balances)) {
              const chainName = this.getChainName(chain)
              const balanceObj = balance as {
                amount: string
                decimals: number
                symbol: string
              }
              const amount = this.formatAmount(balanceObj.amount, balanceObj.decimals)
              console.log(`  💰 ${chainName}: ${amount} ${balanceObj.symbol}`)
            }
          } catch (error) {
            console.log(`  ❌ Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`)
          }
        }

        console.log('\n💡 Balances retrieved from active vault')
        return
      }
    } catch {
      // No active vault available, continue to vault loading
    }

    // No daemon and no active vault - try to load a vault
    console.log('ℹ️  No active vault found, trying to load vault...')

    try {
      // Find available vault files
      const vaultFiles = this.findVaultFiles()

      if (vaultFiles.length === 0) {
        console.log('❌ No vault files found.')
        console.log('   Place .vult files in the vaults/ directory or start daemon with "vultisig run"')
        return
      }

      // Use the first unencrypted vault we find
      let vaultToLoad = null
      for (const vaultFile of vaultFiles) {
        if (vaultFile.includes('NoPassword')) {
          vaultToLoad = vaultFile
          break
        }
      }

      if (!vaultToLoad) {
        vaultToLoad = vaultFiles[0] // Use first available
      }

      console.log('📂 Loading vault:', path.basename(vaultToLoad))

      // Load vault file using the new SDK API
      const fileBuffer = fs.readFileSync(vaultToLoad)
      const file = new File([fileBuffer], path.basename(vaultToLoad))
      // Set buffer property like in the tests
      ;(file as any).buffer = fileBuffer

      // Create SDK instance and add vault
      const sdk = new VultisigSDK()
      const vault = await sdk.addVault(file)

      console.log('\n=== Balances (from loaded vault) ===')

      if (requestedChains.length === 1) {
        // Single chain - use balance() method
        const chain = requestedChains[0]
        try {
          const balance = await vault.balance(chain)
          const chainName = this.getChainName(chain)
          const amount = this.formatAmount(balance.amount, balance.decimals)
          console.log(`  💰 ${chainName}: ${amount} ${balance.symbol}`)
        } catch (error) {
          const chainName = this.getChainName(chain)
          console.log(`  ❌ ${chainName}: Error - ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      } else {
        // Multiple chains - use balances() method
        try {
          const balances = await vault.balances(requestedChains)
          for (const [chain, balance] of Object.entries(balances)) {
            const chainName = this.getChainName(chain)
            const balanceObj = balance as {
              amount: string
              decimals: number
              symbol: string
            }
            const amount = this.formatAmount(balanceObj.amount, balanceObj.decimals)
            console.log(`  💰 ${chainName}: ${amount} ${balanceObj.symbol}`)
          }
        } catch (error) {
          console.log(`  ❌ Failed to get balances: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }
      }

      console.log('\n💡 Balances derived from vault file')
      return
    } catch (error) {
      console.log('❌ Failed to load vault:', error.message)
    }

    // Final fallback
    console.error('❌ No active vault found and no daemon running.')
    console.error('   Start daemon with "vultisig run" first, or load a vault.')
    process.exit(1)
  }

  private parseNetworks(networks: string): string[] {
    if (networks === 'all') {
      return ['bitcoin', 'ethereum', 'solana', 'litecoin', 'dogecoin']
    }

    return networks.split(',').map(n => n.trim().toLowerCase())
  }

  private getChainName(chain: string): string {
    const names: Record<string, string> = {
      bitcoin: 'Bitcoin',
      ethereum: 'Ethereum',
      solana: 'Solana',
      litecoin: 'Litecoin',
      dogecoin: 'Dogecoin',
    }
    return names[chain.toLowerCase()] || chain
  }

  private formatAmount(amount: string, decimals: number): string {
    try {
      // Convert string amount to number, accounting for decimals
      const numAmount = parseFloat(amount) / Math.pow(10, decimals)

      // Format with appropriate decimal places
      if (numAmount === 0) {
        return '0'
      } else if (numAmount < 0.000001) {
        return numAmount.toExponential(2)
      } else if (numAmount < 1) {
        return numAmount.toFixed(6).replace(/\.?0+$/, '')
      } else {
        return numAmount.toFixed(8).replace(/\.?0+$/, '')
      }
    } catch {
      // Fallback to raw amount if formatting fails
      return amount
    }
  }

  private findVaultFiles(): string[] {
    const vaultsDir = path.resolve('vaults')
    if (!fs.existsSync(vaultsDir)) {
      return []
    }

    const files = fs.readdirSync(vaultsDir)
    return files.filter(file => file.endsWith('.vult')).map(file => path.resolve(vaultsDir, file))
  }
}
