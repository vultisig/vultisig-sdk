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

/**
 * Error thrown when user cancels a prompt with Ctrl+C
 */
class PromptCancelledError extends Error {
  name = 'PromptCancelledError'
  constructor() {
    super('Prompt cancelled')
  }
}

import {
  executeAddressBook,
  executeAddresses,
  executeBalance,
  executeChains,
  executeCreateFast,
  executeCreateFromSeedphraseFast,
  executeCreateFromSeedphraseSecure,
  executeCreateSecure,
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
import { stopAllSpinners } from '../lib/output'
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
  private lastSigintTime = 0
  private readonly DOUBLE_CTRL_C_TIMEOUT = 2000 // 2 seconds

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
        const now = Date.now()
        if (now - this.lastSigintTime < this.DOUBLE_CTRL_C_TIMEOUT) {
          // Double Ctrl+C - exit
          rl.close()
          console.log(chalk.yellow('\nGoodbye!'))
          this.ctx.dispose()
          process.exit(0)
        }
        this.lastSigintTime = now
        console.log(chalk.yellow('\n(Press Ctrl+C again to exit)'))
        rl.close()
        resolve('')
      })
    })
  }

  /**
   * Simple prompt for input (used within commands)
   */
  private prompt(message: string, defaultValue?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const displayPrompt = defaultValue ? `${message} [${defaultValue}]: ` : `${message}: `
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      })
      rl.question(displayPrompt, answer => {
        rl.close()
        resolve(answer.trim() || defaultValue || '')
      })
      rl.on('SIGINT', () => {
        rl.close()
        reject(new PromptCancelledError())
      })
    })
  }

  /**
   * Prompt for password input (masked)
   */
  private promptPassword(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      })

      // Mask input
      const stdin = process.stdin
      const onData = (char: Buffer) => {
        const c = char.toString()
        if (c === '\n' || c === '\r') return
        if (c === '\u0003') return // Ctrl+C handled by SIGINT
        if (c === '\u007F' || c === '\b') {
          // Backspace
          process.stdout.write('\b \b')
        } else {
          process.stdout.write('*')
        }
      }

      stdin.on('data', onData)

      rl.question(`${message}: `, answer => {
        stdin.removeListener('data', onData)
        rl.close()
        resolve(answer)
      })
      rl.on('SIGINT', () => {
        stdin.removeListener('data', onData)
        rl.close()
        reject(new PromptCancelledError())
      })
    })
  }

  /**
   * Run an async operation with Ctrl+C cancellation support.
   * Uses Promise.race to avoid wrapping the original promise chain,
   * which can interfere with MPC protocol timing.
   */
  private withCancellation<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abortController = new AbortController()

    // Create a cancellation promise that rejects on SIGINT
    let rejectCancellation: (err: Error) => void
    const cancellationPromise = new Promise<never>((_, reject) => {
      rejectCancellation = reject
    })

    const onSigint = () => {
      cleanup()
      abortController.abort()
      rejectCancellation(new Error('Operation cancelled'))
    }

    const cleanup = () => {
      process.removeListener('SIGINT', onSigint)
    }

    process.on('SIGINT', onSigint)

    // Race the operation against the cancellation promise
    // This preserves the original promise chain timing
    return Promise.race([fn(abortController.signal), cancellationPromise]).finally(cleanup)
  }

  /**
   * Run an async operation with Ctrl+C cancellation support.
   * Creates an AbortController and passes the signal to the operation.
   * On SIGINT, aborts the signal which causes the operation to throw.
   */
  private async withAbortHandler<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()

    const onSigint = () => {
      // Abort the signal - operations check signal.aborted in their loops
      controller.abort()
      // Stop spinners and clean up terminal
      stopAllSpinners()
      process.stdout.write('\x1B[?25h') // Show cursor
      process.stdout.write('\r\x1B[K') // Clear current line
      console.log(chalk.yellow('\nCancelling operation...'))
    }

    const cleanup = () => {
      process.removeListener('SIGINT', onSigint)
    }

    process.on('SIGINT', onSigint)

    try {
      const result = await fn(controller.signal)
      cleanup()
      return result
    } catch (err) {
      cleanup()
      // Stop any remaining spinners on error
      stopAllSpinners()
      // If the signal was aborted, throw a normalized error regardless of wrapping
      // This ensures the caller can check for 'Operation aborted' consistently
      if (controller.signal.aborted) {
        throw new Error('Operation aborted')
      }
      throw err
    }
  }

  /**
   * Process a line of input
   */
  private async processLine(line: string): Promise<void> {
    const input = line.trim()
    if (!input) return

    // Reset double Ctrl+C state when user enters a command
    this.lastSigintTime = 0

    const [command, ...args] = input.split(/\s+/)

    try {
      this.eventBuffer.startCommand()
      await this.executeCommand(command.toLowerCase(), args)
      this.eventBuffer.endCommand()
    } catch (error: any) {
      this.eventBuffer.endCommand()
      // Handle prompt/operation cancellation (Ctrl+C)
      if (
        error.name === 'ExitPromptError' ||
        error.name === 'PromptCancelledError' ||
        error.message === 'Operation cancelled' ||
        error.message === 'Operation aborted'
      ) {
        // Stop all active spinners and clean up terminal state
        stopAllSpinners()
        process.stdout.write('\x1B[?25h') // Show cursor
        process.stdout.write('\r\x1B[K') // Clear current line
        console.log(chalk.yellow('Operation cancelled'))
        return
      }
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
        await this.createVault(args)
        break

      case 'create-from-seedphrase':
        await this.importSeedphrase(args)
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

  private async createVault(args: string[]): Promise<void> {
    const type = args[0]?.toLowerCase()

    if (!type || (type !== 'fast' && type !== 'secure')) {
      console.log(chalk.yellow('Usage: create <fast|secure>'))
      console.log(chalk.gray('  create fast   - Create a fast vault (server-assisted 2-of-2)'))
      console.log(chalk.gray('  create secure - Create a secure vault (multi-device MPC)'))
      return
    }

    let vault
    if (type === 'fast') {
      // Prompt for fast vault options
      const name = await this.prompt('Vault name')
      if (!name) {
        console.log(chalk.red('Name is required'))
        return
      }

      const password = await this.promptPassword('Vault password')
      if (!password) {
        console.log(chalk.red('Password is required'))
        return
      }

      const email = await this.prompt('Email for verification')
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        console.log(chalk.red('Valid email is required'))
        return
      }

      vault = await this.withCancellation(signal => executeCreateFast(this.ctx, { name, password, email, signal }))
    } else {
      // Prompt for secure vault options
      const name = await this.prompt('Vault name')
      if (!name) {
        console.log(chalk.red('Name is required'))
        return
      }

      const sharesStr = await this.prompt('Total shares (devices)', '3')
      const shares = parseInt(sharesStr, 10)
      if (isNaN(shares) || shares < 2) {
        console.log(chalk.red('Must have at least 2 shares'))
        return
      }

      const thresholdStr = await this.prompt('Signing threshold', '2')
      const threshold = parseInt(thresholdStr, 10)
      if (isNaN(threshold) || threshold < 1 || threshold > shares) {
        console.log(chalk.red(`Threshold must be between 1 and ${shares}`))
        return
      }

      const password = await this.promptPassword('Vault password (optional, press Enter to skip)')

      vault = await this.withCancellation(signal =>
        executeCreateSecure(this.ctx, {
          name,
          password: password || undefined,
          threshold,
          shares,
          signal,
        })
      )
    }

    if (vault) {
      this.ctx.addVault(vault)
      this.eventBuffer.setupVaultListeners(vault)
    }
  }

  private async importSeedphrase(args: string[]): Promise<void> {
    const type = args[0]?.toLowerCase()

    if (!type || (type !== 'fast' && type !== 'secure')) {
      console.log(chalk.cyan('Usage: create-from-seedphrase <fast|secure>'))
      console.log(chalk.gray('  fast   - Import with VultiServer (2-of-2)'))
      console.log(chalk.gray('  secure - Import with device coordination (N-of-M)'))
      return
    }

    // Prompt for seedphrase (secure input)
    console.log(chalk.cyan('\nEnter your recovery phrase (words separated by spaces):'))
    const mnemonic = await this.promptPassword('Seedphrase')

    // Validate immediately
    const validation = await this.ctx.sdk.validateSeedphrase(mnemonic)
    if (!validation.valid) {
      console.log(chalk.red(`Invalid seedphrase: ${validation.error}`))
      if (validation.invalidWords?.length) {
        console.log(chalk.yellow(`Invalid words: ${validation.invalidWords.join(', ')}`))
      }
      return
    }
    console.log(chalk.green(`✓ Valid ${validation.wordCount}-word seedphrase`))

    let vault

    if (type === 'fast') {
      // Prompt for FastVault options
      const name = await this.prompt('Vault name')
      if (!name) {
        console.log(chalk.red('Name is required'))
        return
      }

      const password = await this.promptPassword('Vault password')
      if (!password) {
        console.log(chalk.red('Password is required'))
        return
      }

      const email = await this.prompt('Email for verification')
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        console.log(chalk.red('Valid email is required'))
        return
      }

      const discoverStr = await this.prompt('Discover chains with balances? (y/n)', 'y')
      const discoverChains = discoverStr.toLowerCase() === 'y'

      vault = await this.withCancellation(signal =>
        executeCreateFromSeedphraseFast(this.ctx, {
          mnemonic,
          name,
          password,
          email,
          discoverChains,
          signal,
        })
      )
    } else {
      // Prompt for SecureVault options
      const name = await this.prompt('Vault name')
      if (!name) {
        console.log(chalk.red('Name is required'))
        return
      }

      const sharesStr = await this.prompt('Total shares (devices)', '3')
      const shares = parseInt(sharesStr, 10)
      if (isNaN(shares) || shares < 2) {
        console.log(chalk.red('Must have at least 2 shares'))
        return
      }

      const thresholdStr = await this.prompt('Signing threshold', '2')
      const threshold = parseInt(thresholdStr, 10)
      if (isNaN(threshold) || threshold < 1 || threshold > shares) {
        console.log(chalk.red(`Threshold must be between 1 and ${shares}`))
        return
      }

      const password = await this.promptPassword('Vault password (optional, Enter to skip)')

      const discoverStr = await this.prompt('Discover chains with balances? (y/n)', 'y')
      const discoverChains = discoverStr.toLowerCase() === 'y'

      vault = await this.withCancellation(signal =>
        executeCreateFromSeedphraseSecure(this.ctx, {
          mnemonic,
          name,
          password: password || undefined,
          threshold,
          shares,
          discoverChains,
          signal,
        })
      )
    }

    if (vault) {
      this.ctx.addVault(vault)
      this.eventBuffer.setupVaultListeners(vault)
    }
  }

  private async runBalance(args: string[]): Promise<void> {
    const chainStr = args[0]
    const includeTokens = args.includes('-t') || args.includes('--tokens')

    await this.withCancellation(() =>
      executeBalance(this.ctx, {
        chain: chainStr ? findChainByName(chainStr) || (chainStr as Chain) : undefined,
        includeTokens,
      })
    )
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

    await this.withCancellation(() => executePortfolio(this.ctx, { currency }))
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
      // Use withAbortHandler to create an AbortSignal and pass it to executeSend
      await this.withAbortHandler(signal => executeSend(this.ctx, { chain, to, amount, tokenId, memo, signal }))
    } catch (err: any) {
      if (
        err.message === 'Transaction cancelled by user' ||
        err.message === 'Operation cancelled' ||
        err.message === 'Operation aborted'
      ) {
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

    await this.withCancellation(() => executeSwapQuote(this.ctx, { fromChain, toChain, amount, fromToken, toToken }))
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
      // Use withAbortHandler to create an AbortSignal and pass it to executeSwap
      await this.withAbortHandler(signal =>
        executeSwap(this.ctx, { fromChain, toChain, amount, fromToken, toToken, slippage, signal })
      )
    } catch (err: any) {
      if (
        err.message === 'Swap cancelled by user' ||
        err.message === 'Operation cancelled' ||
        err.message === 'Operation aborted'
      ) {
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
