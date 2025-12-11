/**
 * Shell Session - Interactive shell using readline
 *
 * Provides an interactive shell with:
 * - All CLI commands available
 * - Shell-only commands (lock, unlock, status)
 * - Tab completion
 * - Event buffering
 * - Dynamic prompt showing vault name and lock status
 */
import type { FiatCurrency, Vultisig } from '@vultisig/sdk'
import { Chain, fiatCurrencies } from '@vultisig/sdk'
import chalk from 'chalk'
import ora from 'ora'
import * as readline from 'readline'

import {
  executeAddressBook,
  executeAddresses,
  executeBalance,
  executeChains,
  executeCreate,
  executeCurrency,
  executeExport,
  executeImport,
  executeInfo,
  executePortfolio,
  executeRename,
  executeSend,
  executeServer,
  executeSwap,
  executeSwapChains,
  executeSwapQuote,
  executeTokens,
  executeVaults,
} from '../commands'
import { createCompleter, findChainByName } from './completer'
import { EventBuffer } from './event-buffer'
import { executeLock, executeStatus, executeUnlock, showHelp } from './shell-commands'
import { createShellContext, ShellContext } from './shell-context'

/**
 * Create a spinner for async operations
 */
function createSpinner(text: string) {
  return ora({
    text,
    hideCursor: false,
    stream: process.stdout,
    isEnabled: true,
    isSilent: false,
  })
}

/**
 * Interactive Shell Session
 */
export class ShellSession {
  private ctx: ShellContext
  private eventBuffer: EventBuffer

  constructor(sdk: Vultisig, options?: { passwordTtlMs?: number }) {
    this.ctx = createShellContext(sdk, options)
    this.eventBuffer = new EventBuffer()
  }

  /**
   * Start the interactive shell
   */
  async start(): Promise<void> {
    console.clear()
    console.log(chalk.cyan.bold('\n=============================================='))
    console.log(chalk.cyan.bold('         Vultisig Interactive Shell'))
    console.log(chalk.cyan.bold('==============================================\n'))

    // Load all vaults
    await this.loadAllVaults()

    // Display vault list
    this.displayVaultList()

    // Show quick help
    console.log(chalk.gray('Type "help" for available commands, "exit" to quit\n'))

    // Start the command loop
    this.promptLoop().catch(() => {})
  }

  /**
   * Main prompt loop - creates fresh readline for each command
   */
  private async promptLoop(): Promise<void> {
    while (true) {
      const line = await this.readLine(this.getPrompt())
      await this.processLine(line)
    }
  }

  /**
   * Read a single line with tab completion, then close readline
   */
  private readLine(prompt: string): Promise<string> {
    return new Promise(resolve => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        completer: (line: string, cb: (err: Error | null, result: [string[], string]) => void) => {
          cb(null, createCompleter(this.ctx)(line))
        },
        terminal: true,
      })
      rl.question(prompt, answer => {
        rl.close()
        resolve(answer)
      })
      rl.on('SIGINT', () => {
        rl.close()
        console.log(chalk.yellow('\nGoodbye!'))
        this.ctx.dispose()
        process.exit(0)
      })
    })
  }

  /**
   * Process a line of input
   */
  private async processLine(line: string): Promise<void> {
    const input = line.trim()
    if (!input) return

    const [command, ...args] = input.split(/\s+/)

    try {
      this.eventBuffer.startCommand()
      await this.executeCommand(command.toLowerCase(), args)
      this.eventBuffer.endCommand()
    } catch (error: any) {
      this.eventBuffer.endCommand()
      console.error(chalk.red(`\nError: ${error.message}`))
    }
  }

  /**
   * Execute a command
   */
  private async executeCommand(command: string, args: string[]): Promise<void> {
    switch (command) {
      // Vault management
      case 'vaults':
        await executeVaults(this.ctx)
        break

      case 'vault':
        await this.switchVault(args)
        break

      case 'import':
        await this.importVault(args)
        break

      case 'create':
        await this.createVault()
        break

      case 'info':
        await executeInfo(this.ctx)
        break

      case 'export':
        await executeExport(this.ctx, { outputPath: args.join(' ') || undefined })
        break

      case 'rename':
        if (args.length === 0) {
          console.log(chalk.yellow('Usage: rename <newName>'))
          return
        }
        await executeRename(this.ctx, args.join(' '))
        break

      // Balance commands
      case 'balance':
      case 'bal':
        await this.runBalance(args)
        break

      case 'portfolio':
        await this.runPortfolio(args)
        break

      // Transaction
      case 'send':
        await this.runSend(args)
        break

      // Chain management
      case 'addresses':
        await executeAddresses(this.ctx)
        break

      case 'chains':
        await this.runChains(args)
        break

      case 'tokens':
        await this.runTokens(args)
        break

      // Swap commands
      case 'swap-chains':
        await executeSwapChains(this.ctx)
        break

      case 'swap-quote':
        await this.runSwapQuote(args)
        break

      case 'swap':
        await this.runSwap(args)
        break

      // Shell-only commands
      case 'lock':
        await executeLock(this.ctx)
        break

      case 'unlock':
        await executeUnlock(this.ctx)
        break

      case 'status':
        await executeStatus(this.ctx)
        break

      // Settings
      case 'currency':
        await executeCurrency(this.ctx, args[0])
        break

      case 'server':
        await executeServer(this.ctx)
        break

      case 'address-book':
        await this.runAddressBook(args)
        break

      // Help
      case 'help':
      case '?':
        showHelp()
        break

      // Clear screen
      case 'clear':
        console.clear()
        this.displayVaultList()
        break

      // Exit
      case 'exit':
      case 'quit':
        console.log(chalk.yellow('\nGoodbye!'))
        this.ctx.dispose()
        process.exit(0)
        break // eslint requires break even after process.exit

      default:
        console.log(chalk.yellow(`Unknown command: ${command}`))
        console.log(chalk.gray('Type "help" for available commands'))
        break
    }
  }

  // ===== Command Helpers =====

  private async switchVault(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: vault <name>'))
      console.log(chalk.gray('Run "vaults" to see available vaults'))
      return
    }

    const vaultName = args.join(' ')
    const vault = this.ctx.findVaultByName(vaultName)

    if (!vault) {
      console.log(chalk.red(`Vault not found: ${vaultName}`))
      console.log(chalk.gray('Run "vaults" to see available vaults'))
      return
    }

    await this.ctx.setActiveVault(vault)
    console.log(chalk.green(`\n+ Switched to: ${vault.name}`))

    const isUnlocked = this.ctx.isVaultUnlocked(vault.id)
    const status = isUnlocked ? chalk.green('Unlocked') : chalk.yellow('Locked')
    console.log(`Status: ${status}`)
  }

  private async importVault(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: import <file>'))
      return
    }

    const filePath = args.join(' ')
    const vault = await executeImport(this.ctx, filePath)
    this.ctx.addVault(vault)
    this.eventBuffer.setupVaultListeners(vault)
  }

  private async createVault(): Promise<void> {
    const vault = await executeCreate(this.ctx, { type: 'fast' })
    this.ctx.addVault(vault)
    this.eventBuffer.setupVaultListeners(vault)
  }

  private async runBalance(args: string[]): Promise<void> {
    const chainStr = args[0]
    const includeTokens = args.includes('-t') || args.includes('--tokens')

    await executeBalance(this.ctx, {
      chain: chainStr ? findChainByName(chainStr) || (chainStr as Chain) : undefined,
      includeTokens,
    })
  }

  private async runPortfolio(args: string[]): Promise<void> {
    let currency: FiatCurrency = 'usd'

    for (let i = 0; i < args.length; i++) {
      if ((args[i] === '-c' || args[i] === '--currency') && i + 1 < args.length) {
        currency = args[i + 1].toLowerCase() as FiatCurrency
        i++
      }
    }

    if (!fiatCurrencies.includes(currency)) {
      console.log(chalk.red(`Invalid currency: ${currency}`))
      console.log(chalk.yellow(`Supported currencies: ${fiatCurrencies.join(', ')}`))
      return
    }

    await executePortfolio(this.ctx, { currency })
  }

  private async runSend(args: string[]): Promise<void> {
    if (args.length < 3) {
      console.log(chalk.yellow('Usage: send <chain> <to> <amount> [--token <tokenId>] [--memo <memo>]'))
      return
    }

    const [chainStr, to, amount, ...rest] = args
    const chain = findChainByName(chainStr) || (chainStr as Chain)

    let tokenId: string | undefined
    let memo: string | undefined

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--token' && i + 1 < rest.length) {
        tokenId = rest[i + 1]
        i++
      } else if (rest[i] === '--memo' && i + 1 < rest.length) {
        memo = rest.slice(i + 1).join(' ')
        break
      }
    }

    try {
      await executeSend(this.ctx, { chain, to, amount, tokenId, memo })
    } catch (err: any) {
      if (err.message === 'Transaction cancelled by user') {
        console.log(chalk.yellow('\nTransaction cancelled'))
        return
      }
      throw err
    }
  }

  private async runChains(args: string[]): Promise<void> {
    let addChain: Chain | undefined
    let removeChain: Chain | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--add' && i + 1 < args.length) {
        const chain = findChainByName(args[i + 1])
        if (!chain) {
          console.log(chalk.red(`Unknown chain: ${args[i + 1]}`))
          console.log(chalk.gray('Use tab completion to see available chains'))
          return
        }
        addChain = chain
        i++
      } else if (args[i] === '--remove' && i + 1 < args.length) {
        const chain = findChainByName(args[i + 1])
        if (!chain) {
          console.log(chalk.red(`Unknown chain: ${args[i + 1]}`))
          console.log(chalk.gray('Use tab completion to see available chains'))
          return
        }
        removeChain = chain
        i++
      }
    }

    await executeChains(this.ctx, { add: addChain, remove: removeChain })
  }

  private async runTokens(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: tokens <chain> [--add <address>] [--remove <tokenId>]'))
      return
    }

    const chainStr = args[0]
    const chain = findChainByName(chainStr) || (chainStr as Chain)

    let add: string | undefined
    let remove: string | undefined

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--add' && i + 1 < args.length) {
        add = args[i + 1]
        i++
      } else if (args[i] === '--remove' && i + 1 < args.length) {
        remove = args[i + 1]
        i++
      }
    }

    await executeTokens(this.ctx, { chain, add, remove })
  }

  private async runSwapQuote(args: string[]): Promise<void> {
    if (args.length < 3) {
      console.log(
        chalk.yellow('Usage: swap-quote <fromChain> <toChain> <amount> [--from-token <addr>] [--to-token <addr>]')
      )
      return
    }

    const [fromChainStr, toChainStr, amountStr, ...rest] = args
    const fromChain = findChainByName(fromChainStr) || (fromChainStr as Chain)
    const toChain = findChainByName(toChainStr) || (toChainStr as Chain)
    const amount = parseFloat(amountStr)

    let fromToken: string | undefined
    let toToken: string | undefined

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--from-token' && i + 1 < rest.length) {
        fromToken = rest[i + 1]
        i++
      } else if (rest[i] === '--to-token' && i + 1 < rest.length) {
        toToken = rest[i + 1]
        i++
      }
    }

    await executeSwapQuote(this.ctx, { fromChain, toChain, amount, fromToken, toToken })
  }

  private async runSwap(args: string[]): Promise<void> {
    if (args.length < 3) {
      console.log(
        chalk.yellow(
          'Usage: swap <fromChain> <toChain> <amount> [--from-token <addr>] [--to-token <addr>] [--slippage <pct>]'
        )
      )
      return
    }

    const [fromChainStr, toChainStr, amountStr, ...rest] = args
    const fromChain = findChainByName(fromChainStr) || (fromChainStr as Chain)
    const toChain = findChainByName(toChainStr) || (toChainStr as Chain)
    const amount = parseFloat(amountStr)

    let fromToken: string | undefined
    let toToken: string | undefined
    let slippage: number | undefined

    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--from-token' && i + 1 < rest.length) {
        fromToken = rest[i + 1]
        i++
      } else if (rest[i] === '--to-token' && i + 1 < rest.length) {
        toToken = rest[i + 1]
        i++
      } else if (rest[i] === '--slippage' && i + 1 < rest.length) {
        slippage = parseFloat(rest[i + 1])
        i++
      }
    }

    try {
      await executeSwap(this.ctx, { fromChain, toChain, amount, fromToken, toToken, slippage })
    } catch (err: any) {
      if (err.message === 'Swap cancelled by user') {
        console.log(chalk.yellow('\nSwap cancelled'))
        return
      }
      throw err
    }
  }

  private async runAddressBook(args: string[]): Promise<void> {
    let add = false
    let remove: string | undefined
    let chain: Chain | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--add') {
        add = true
      } else if (args[i] === '--remove' && i + 1 < args.length) {
        remove = args[i + 1]
        i++
      } else if (args[i] === '--chain' && i + 1 < args.length) {
        chain = findChainByName(args[i + 1]) || (args[i + 1] as Chain)
        i++
      }
    }

    await executeAddressBook(this.ctx, { add, remove, chain })
  }

  // ===== Setup =====

  private async loadAllVaults(): Promise<void> {
    const spinner = createSpinner('Loading vaults...').start()

    try {
      // Load active vault first
      const activeVault = await this.ctx.sdk.getActiveVault()
      if (activeVault) {
        this.ctx.addVault(activeVault)
        await this.ctx.setActiveVault(activeVault)
        this.eventBuffer.setupVaultListeners(activeVault)
      }

      // Load all vaults
      const vaultList = await this.ctx.sdk.listVaults()
      if (vaultList && vaultList.length > 0) {
        vaultList.forEach(vault => {
          if (!this.ctx.getVaultById(vault.id)) {
            this.ctx.addVault(vault)
            this.eventBuffer.setupVaultListeners(vault)
          }
        })

        // Set first vault as active if none set
        if (!this.ctx.getActiveVault() && this.ctx.getVaults().size > 0) {
          const firstVault = this.ctx.getVaults().values().next().value
          await this.ctx.setActiveVault(firstVault)
        }

        spinner.succeed(`Loaded ${this.ctx.getVaults().size} vault(s)`)
      } else if (this.ctx.getVaults().size > 0) {
        spinner.succeed(`Loaded ${this.ctx.getVaults().size} vault(s)`)
      } else {
        spinner.succeed('No vaults found')
      }
    } catch (error) {
      if (this.ctx.getVaults().size > 0) {
        spinner.succeed(`Loaded ${this.ctx.getVaults().size} vault(s)`)
      } else {
        spinner.fail('Failed to load vaults')
        throw error
      }
    }
  }

  private getPrompt(): string {
    const vault = this.ctx.getActiveVault()
    if (!vault) return chalk.cyan('wallet> ')

    const isUnlocked = this.ctx.isVaultUnlocked(vault.id)
    const status = isUnlocked ? chalk.green('🔓') : chalk.yellow('🔒')
    return chalk.cyan(`wallet[${vault.name}]${status}> `)
  }

  private displayVaultList(): void {
    const vaults = Array.from(this.ctx.getVaults().values())
    const activeVault = this.ctx.getActiveVault()

    if (vaults.length === 0) {
      console.log(chalk.yellow('No vaults found. Use "create" or "import <file>" to add a vault.\n'))
      return
    }

    console.log(chalk.cyan('Loaded Vaults:\n'))
    vaults.forEach(vault => {
      const isActive = vault.id === activeVault?.id
      const isUnlocked = this.ctx.isVaultUnlocked(vault.id)
      const activeMarker = isActive ? chalk.green(' (active)') : ''
      const lockIcon = isUnlocked ? chalk.green('🔓') : chalk.yellow('🔒')
      console.log(`  ${lockIcon} ${vault.name}${activeMarker} - ${vault.type}`)
    })
    console.log()
  }
}
