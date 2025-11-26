import { Chain, FastVault, fiatCurrencies, FiatCurrency, VaultBase, Vultisig } from '@vultisig/sdk'
import chalk from 'chalk'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import inquirer from 'inquirer'
import ora, { Ora } from 'ora'
import path from 'path'
import * as repl from 'repl'

/**
 * Create a REPL-safe spinner that doesn't interfere with stdin
 */
function createReplSafeSpinner(text: string): Ora {
  return ora({
    text,
    hideCursor: false,
    stream: process.stdout,
    isEnabled: true,
    isSilent: false,
  })
}

import {
  displayAddresses,
  displayBalances,
  displayChainAdded,
  displayChainRemoved,
  displayChains,
  displayExported,
  displayLocked,
  displayPortfolio,
  displayStatus,
  displayTokenAdded,
  displayTokenRemoved,
  displayTokens,
  displayTransactionResult,
  displayUnlocked,
  displayVaultCreated,
  displayVaultImported,
  displayVaultList,
  formatTimeRemaining,
  VaultStatus,
} from './commands'
import { CommandExecutor } from './utils/command-executor'
import { EventManager } from './utils/event-manager'
import { TransactionManager } from './utils/transaction'
import { PortfolioSummary } from './utils/types'

/**
 * REPL Session - Interactive wallet using Node.js REPL module
 */
export class ReplSession {
  private sdk: Vultisig
  private vaults: Map<string, VaultBase> = new Map()
  private transactionManagers: Map<string, TransactionManager> = new Map()
  private activeVaultId: string | null = null
  private replServer!: repl.REPLServer
  private lastCommand: string = ''
  private commandExecutor: CommandExecutor
  private eventManager: EventManager

  constructor(sdk: Vultisig) {
    this.sdk = sdk
    this.commandExecutor = new CommandExecutor()
    this.eventManager = new EventManager()
  }

  /**
   * Start the REPL session
   */
  async start(): Promise<void> {
    console.clear()
    console.log(chalk.cyan.bold('\n═══════════════════════════════════════════'))
    console.log(chalk.cyan.bold('       Vultisig Interactive Shell'))
    console.log(chalk.cyan.bold('═══════════════════════════════════════════\n'))

    // Load all vaults
    await this.loadAllVaults()

    // Display vault list
    this.displayVaultList()

    // Show quick help
    console.log(chalk.gray('Type ".help" for available commands, ".exit" to quit\n'))

    // Create the REPL server with completer
    this.replServer = repl.start({
      prompt: this.getPrompt(),
      eval: this.evalCommand.bind(this),
      ignoreUndefined: true,
      terminal: true,
      useColors: true,
      completer: this.completer.bind(this),
    })

    // Setup REPL commands
    this.setupCommands()

    // Setup event listeners
    this.setupEventListeners()
  }

  /**
   * Custom eval function for command processing
   */
  private async evalCommand(
    cmd: string,
    context: any,
    filename: string,
    callback: (err: Error | null, result?: any) => void
  ): Promise<void> {
    const input = cmd.trim()

    // Handle empty input
    if (!input) {
      callback(null)
      return
    }

    // Track the last command for tab completion context
    this.lastCommand = input

    // Parse command and arguments
    const [command, ...args] = input.split(/\s+/)

    try {
      // Start command execution - buffer events during command
      this.eventManager.startCommand()

      // Execute command
      await this.executeUserCommand(command, args)

      // End command execution - flush buffered events
      this.eventManager.endCommand()

      // Update prompt if needed
      this.replServer.setPrompt(this.getPrompt())

      // Signal completion to REPL
      callback(null)
    } catch (error: any) {
      // End command execution even on error
      this.eventManager.endCommand()

      // Show error
      console.error(chalk.red(`✗ Error: ${error.message}`))

      // Update prompt
      this.replServer.setPrompt(this.getPrompt())

      // Signal completion
      callback(null)
    }
  }

  /**
   * Execute a user command
   */
  private async executeUserCommand(command: string, args: string[]): Promise<void> {
    await this.commandExecutor.execute(async () => {
      switch (command.toLowerCase()) {
        case 'vaults':
          await this.cmdListVaults()
          break

        case 'vault':
          await this.cmdVaultSwitch(args)
          break

        case 'import':
          await this.cmdImport(args)
          break

        case 'create':
          await this.cmdCreate()
          break

        case 'balance':
        case 'bal':
          await this.cmdBalance(args)
          break

        case 'send':
          await this.cmdSend(args)
          break

        case 'portfolio':
          await this.cmdPortfolio(args)
          break

        case 'addresses':
          await this.cmdAddresses()
          break

        case 'chains':
          await this.cmdChains(args)
          break

        case 'tokens':
        case 'token':
          await this.cmdTokens(args)
          break

        case 'lock':
          await this.cmdLock()
          break

        case 'unlock':
          await this.cmdUnlock()
          break

        case 'status':
          await this.cmdStatus()
          break

        case 'export':
          await this.cmdExport(args)
          break

        case 'help':
        case '?':
          this.showHelp()
          break

        default:
          // Unknown command - silently ignore
          break
      }
    }, command)
  }

  /**
   * Setup REPL dot-commands
   */
  private setupCommands(): void {
    // Add .help command
    this.replServer.defineCommand('help', {
      help: 'Show available commands',
      action: () => {
        this.showHelp()
        this.replServer.displayPrompt()
      },
    })

    // Add .clear command
    this.replServer.defineCommand('clear', {
      help: 'Clear the screen',
      action: () => {
        console.clear()
        this.displayVaultList()
        this.replServer.displayPrompt()
      },
    })

    // Override .exit to clean up
    const originalExit = this.replServer.commands.exit
    this.replServer.defineCommand('exit', {
      help: originalExit.help,
      action: () => {
        console.log(chalk.yellow('\nGoodbye!'))
        originalExit.action.call(this.replServer)
      },
    })
  }

  /**
   * Tab completion handler
   */
  private completer(line: string): [string[], string] {
    const commands = [
      'vaults',
      'vault',
      'import',
      'create',
      'balance',
      'bal',
      'send',
      'portfolio',
      'addresses',
      'chains',
      'lock',
      'unlock',
      'status',
      'export',
      'help',
      '?',
      '.help',
      '.clear',
      '.exit',
    ]

    try {
      // Check if we're completing a file path for import/export commands
      const parts = line.split(/\s+/)
      const command = parts[0]?.toLowerCase()

      // If we're typing after import or export, provide file completion
      if ((command === 'import' || command === 'export') && parts.length > 1) {
        const partial = parts.slice(1).join(' ')
        this.lastCommand = command
        return this.completeFilePath(partial)
      }

      // If we're typing after vault, provide vault name completion
      if (command === 'vault' && parts.length > 1) {
        const partial = parts.slice(1).join(' ')
        return this.completeVaultName(partial)
      }

      // If we're typing after chains --add or chains --remove, provide chain completion
      if (command === 'chains' && parts.length >= 2) {
        const flag = parts[parts.length - 2]?.toLowerCase()
        if (flag === '--add' || flag === '--remove') {
          const partial = parts[parts.length - 1] || ''
          return this.completeChainName(partial)
        }
        if (
          parts[parts.length - 1]?.toLowerCase() === '--add' ||
          parts[parts.length - 1]?.toLowerCase() === '--remove'
        ) {
          return this.completeChainName('')
        }
      }

      // Otherwise, complete commands
      const hits = commands.filter(c => c.startsWith(line))
      const show = hits.length ? hits : commands
      return [show, line]
    } catch {
      return [[], line]
    }
  }

  /**
   * File path completion helper
   */
  private completeFilePath(partial: string): [string[], string] {
    try {
      const endsWithSeparator = partial.endsWith('/') || partial.endsWith(path.sep)

      let dir: string
      let basename: string

      if (endsWithSeparator) {
        dir = partial
        basename = ''
      } else {
        dir = path.dirname(partial)
        basename = path.basename(partial)

        if (fs.existsSync(partial) && fs.statSync(partial).isDirectory()) {
          dir = partial
          basename = ''
        }
      }

      const resolvedDir = path.resolve(dir)

      if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
        return [[], partial]
      }

      const files = fs.readdirSync(resolvedDir)

      const matches = files
        .filter((file: string) => file.startsWith(basename))
        .map((file: string) => {
          const fullPath = path.join(dir, file)
          const stats = fs.statSync(path.join(resolvedDir, file))

          if (stats.isDirectory()) {
            return fullPath + '/'
          }

          const isImportCommand = this.lastCommand?.toLowerCase().startsWith('import')
          if (isImportCommand) {
            if (file.endsWith('.vult') || stats.isDirectory()) {
              return fullPath
            }
            return null
          }

          return fullPath
        })
        .filter((item: string | null) => item !== null)

      return [matches as string[], partial]
    } catch {
      return [[], partial]
    }
  }

  /**
   * Chain name completion helper (case-insensitive)
   */
  private completeChainName(partial: string): [string[], string] {
    const allChains = Object.values(Chain) as string[]
    const partialLower = partial.toLowerCase()
    const matches = allChains.filter((chain: string) => chain.toLowerCase().startsWith(partialLower))
    matches.sort()
    const show = matches.length > 0 ? matches : allChains.sort()
    return [show, partial]
  }

  /**
   * Find a chain by name (case-insensitive)
   */
  private findChainByName(name: string): Chain | null {
    const allChains = Object.values(Chain) as string[]
    const nameLower = name.toLowerCase()
    const found = allChains.find((chain: string) => chain.toLowerCase() === nameLower)
    return found ? (found as Chain) : null
  }

  /**
   * Vault name completion helper (case-insensitive)
   */
  private completeVaultName(partial: string): [string[], string] {
    const vaultNames = Array.from(this.vaults.values()).map(vault => vault.name)
    const partialLower = partial.toLowerCase()
    const matches = vaultNames.filter((name: string) => name.toLowerCase().startsWith(partialLower))
    matches.sort()
    const show = matches.length > 0 ? matches : vaultNames.sort()
    return [show, partial]
  }

  /**
   * Find a vault by name (case-insensitive)
   */
  private findVaultByName(name: string): VaultBase | null {
    const vaults = Array.from(this.vaults.values())
    const nameLower = name.toLowerCase()
    const found = vaults.find(vault => vault.name.toLowerCase() === nameLower)
    return found || null
  }

  /**
   * Setup event listeners for vaults
   */
  private setupEventListeners(): void {
    this.vaults.forEach(vault => {
      this.setupVaultEventListeners(vault)
    })
  }

  /**
   * Setup event listeners for a specific vault
   */
  private setupVaultEventListeners(vault: VaultBase): void {
    this.eventManager.setupVaultListeners(vault)

    vault.on('unlocked', () => {
      this.updatePrompt()
    })
  }

  /**
   * Load all vaults from storage
   */
  private async loadAllVaults(): Promise<void> {
    const spinner = createReplSafeSpinner('Loading vaults...').start()

    try {
      const activeVault = await this.sdk.getActiveVault()
      if (activeVault) {
        this.vaults.set(activeVault.id, activeVault)
        this.transactionManagers.set(activeVault.id, new TransactionManager(activeVault))
        this.setActiveVault(activeVault.id)
      }

      const vaultList = await this.sdk.listVaults()

      if (vaultList && vaultList.length > 0) {
        vaultList.forEach(vault => {
          if (!this.vaults.has(vault.id)) {
            this.vaults.set(vault.id, vault)
            this.transactionManagers.set(vault.id, new TransactionManager(vault))
          }
        })

        if (!this.activeVaultId && this.vaults.size > 0) {
          this.setActiveVault(this.vaults.keys().next().value)
        }
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else if (this.vaults.size > 0) {
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else {
        spinner.succeed('No vaults found')
      }
    } catch (error) {
      if (this.vaults.size > 0) {
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else {
        spinner.fail('Failed to load vaults')
        throw error
      }
    }
  }

  // ===== Command Implementations =====

  private async cmdListVaults(): Promise<void> {
    const vaults = Array.from(this.vaults.values())
    displayVaultList(vaults, this.activeVaultId || undefined)
  }

  private async cmdVaultSwitch(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: vault <name>'))
      console.log(chalk.gray('Run "vaults" to see available vaults'))
      return
    }

    const vaultName = args.join(' ')
    const vault = this.findVaultByName(vaultName)

    if (!vault) {
      console.log(chalk.red(`Vault not found: ${vaultName}`))
      console.log(chalk.gray('Run "vaults" to see available vaults'))
      return
    }

    this.setActiveVault(vault.id)

    console.log(chalk.green(`Switched to: ${vault.name}`))
    const status = vault.isUnlocked() ? chalk.green('Unlocked 🔓') : chalk.yellow('Locked 🔒')
    console.log(`Status: ${status}`)
  }

  private async cmdImport(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: import <file>'))
      return
    }

    const filePath = args.join(' ')

    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter vault password (if encrypted):',
        mask: '*',
      },
    ])

    const spinner = createReplSafeSpinner('Importing vault...').start()

    await fsPromises.access(filePath)
    const vultContent = await fsPromises.readFile(filePath, 'utf-8')
    const vault = await this.sdk.importVault(vultContent, password || undefined)

    this.vaults.set(vault.id, vault)
    this.transactionManagers.set(vault.id, new TransactionManager(vault))
    this.setupVaultEventListeners(vault)

    this.setActiveVault(vault.id)

    spinner.succeed('Vault imported')
    displayVaultImported(vault)
  }

  private async cmdCreate(): Promise<void> {
    const answers = (await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Enter vault name:',
        validate: (input: string) => input.trim() !== '' || 'Name is required',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Enter password:',
        mask: '*',
        validate: (input: string) => input.length >= 8 || 'Password must be at least 8 characters',
      },
      {
        type: 'password',
        name: 'confirmPassword',
        message: 'Confirm password:',
        mask: '*',
        validate: (input: string, answers: any) => input === answers.password || 'Passwords do not match',
      },
      {
        type: 'input',
        name: 'email',
        message: 'Enter email for verification:',
        validate: (input: string) => /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
      },
    ])) as any

    const result = await FastVault.create({
      name: answers.name,
      password: answers.password,
      email: answers.email,
    })

    this.vaults.set(result.vault.id, result.vault)
    this.transactionManagers.set(result.vault.id, new TransactionManager(result.vault))
    this.setupVaultEventListeners(result.vault)

    this.setActiveVault(result.vault.id)

    if (result.verificationRequired) {
      console.log(chalk.yellow('\n📧 A verification code has been sent to your email.'))
      console.log(chalk.blue('Please check your inbox and enter the code.'))

      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: `Verification code sent to ${answers.email}. Enter code:`,
          validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
        },
      ])

      const verified = await this.sdk.verifyVault(result.vaultId, code)

      if (!verified) {
        console.error(chalk.red('\n✗ Verification failed. Please check the code and try again.'))
        return
      }
    }

    displayVaultCreated(result.vault.name)
  }

  private async cmdBalance(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    const chainStr = args[0]
    const includeTokens = args.includes('-t') || args.includes('--tokens')

    const spinner = createReplSafeSpinner('Loading balances...').start()

    const result = chainStr
      ? await vault.balance(chainStr as Chain, undefined)
      : await vault.balances(undefined, includeTokens)

    spinner.succeed('Balances loaded')
    displayBalances(result, chainStr)
  }

  private async cmdSend(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    if (args.length < 3) {
      console.log(chalk.yellow('Usage: send <chain> <to> <amount> [--token <tokenId>] [--memo <memo>]'))
      return
    }

    const [chainStr, to, amount, ...rest] = args
    const chain = chainStr as Chain

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

    const transactionManager = this.transactionManagers.get(vault.id)
    if (!transactionManager) {
      throw new Error('Transaction manager not initialized')
    }

    const result = await transactionManager.send({
      chain,
      to,
      amount,
      tokenId,
      memo,
    })

    displayTransactionResult(result)
  }

  private async cmdPortfolio(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

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

    const chains = vault.getChains()
    if (chains.length === 0) {
      console.log(chalk.yellow('\nNo chains added to this vault yet.'))
      console.log(chalk.gray('Use "chains --add <chain>" to add a chain first.'))
      return
    }

    const spinner = createReplSafeSpinner('Loading portfolio...').start()

    const totalValue = await vault.getTotalValue(currency)
    const chainBalances = await Promise.all(
      chains.map(async chain => {
        const balance = await vault.balance(chain)
        try {
          const value = await vault.getValue(chain, undefined, currency)
          return { chain, balance, value }
        } catch {
          return { chain, balance }
        }
      })
    )

    const portfolio: PortfolioSummary = { totalValue, chainBalances }

    spinner.succeed('Portfolio loaded')
    displayPortfolio(portfolio, currency)
  }

  private async cmdAddresses(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    const spinner = createReplSafeSpinner('Loading addresses...').start()

    const addresses = await vault.addresses()
    spinner.succeed('Addresses loaded')
    displayAddresses(addresses)
  }

  private async cmdChains(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    let addChain: string | undefined
    let removeChain: string | undefined

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--add' && i + 1 < args.length) {
        addChain = args[i + 1]
        i++
      } else if (args[i] === '--remove' && i + 1 < args.length) {
        removeChain = args[i + 1]
        i++
      }
    }

    if (addChain) {
      const chain = this.findChainByName(addChain)
      if (!chain) {
        console.error(chalk.red(`Unknown chain: ${addChain}`))
        console.log(chalk.gray('Use tab completion to see available chains'))
        return
      }
      await vault.addChain(chain)
      const address = await vault.address(chain)
      displayChainAdded(chain, address)
    } else if (removeChain) {
      const chain = this.findChainByName(removeChain)
      if (!chain) {
        console.error(chalk.red(`Unknown chain: ${removeChain}`))
        console.log(chalk.gray('Use tab completion to see available chains'))
        return
      }
      await vault.removeChain(chain)
      displayChainRemoved(chain)
    } else {
      const chains = vault.getChains()
      displayChains(chains)
    }
  }

  private async cmdTokens(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    let chain: string | undefined
    let addAddress: string | undefined
    let removeTokenId: string | undefined
    let symbol: string | undefined
    let decimals: number | undefined

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--chain' && i + 1 < args.length) {
        chain = args[i + 1]
        i++
      } else if (arg === '--add' && i + 1 < args.length) {
        addAddress = args[i + 1]
        i++
      } else if (arg === '--remove' && i + 1 < args.length) {
        removeTokenId = args[i + 1]
        i++
      } else if (arg === '--symbol' && i + 1 < args.length) {
        symbol = args[i + 1]
        i++
      } else if (arg === '--decimals' && i + 1 < args.length) {
        decimals = parseInt(args[i + 1], 10)
        i++
      } else if (!chain && !arg.startsWith('--')) {
        chain = arg
      }
    }

    if (!chain) {
      console.log(chalk.red('Chain is required'))
      console.log(
        chalk.gray(
          'Usage: tokens <chain> [--add <address> --symbol <symbol> --decimals <decimals>] [--remove <tokenId>]'
        )
      )
      return
    }

    const chainEnum = this.findChainByName(chain)
    if (!chainEnum) {
      console.error(chalk.red(`Unknown chain: ${chain}`))
      console.log(chalk.gray('Use tab completion to see available chains'))
      return
    }

    if (addAddress) {
      if (!symbol) {
        console.log(chalk.red('Symbol is required when adding a token'))
        console.log(chalk.gray('Usage: tokens <chain> --add <address> --symbol <symbol> [--decimals <decimals>]'))
        return
      }

      const token = {
        id: `${chainEnum}-${addAddress}`,
        name: symbol,
        symbol,
        decimals: decimals || 18,
        contractAddress: addAddress,
        chainId: chainEnum,
        isNative: false,
      }

      await vault.addToken(chainEnum, token)
      displayTokenAdded(chainEnum, symbol)
    } else if (removeTokenId) {
      await vault.removeToken(chainEnum, removeTokenId)
      displayTokenRemoved(chainEnum, removeTokenId)
    } else {
      const tokens = vault.getTokens(chainEnum)
      displayTokens(chainEnum, tokens)
    }
  }

  private async cmdLock(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    vault.lock()
    displayLocked()
    this.updatePrompt()
  }

  private async cmdUnlock(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter vault password:',
        mask: '*',
      },
    ])

    const spinner = createReplSafeSpinner('Unlocking vault...').start()

    await vault.unlock(password)
    const timeRemaining = vault.getUnlockTimeRemaining()
    const timeRemainingFormatted = formatTimeRemaining(timeRemaining)

    spinner.succeed('Vault unlocked')
    displayUnlocked(timeRemainingFormatted)
    this.updatePrompt()
  }

  private async cmdStatus(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    const isUnlocked = vault.isUnlocked()
    let timeRemaining: number | undefined
    let timeRemainingFormatted: string | undefined

    if (isUnlocked) {
      timeRemaining = vault.getUnlockTimeRemaining()
      timeRemainingFormatted = formatTimeRemaining(timeRemaining)
    }

    const status: VaultStatus = {
      name: vault.name,
      id: vault.id,
      type: vault.type,
      isUnlocked,
      timeRemaining,
      timeRemainingFormatted,
      createdAt: vault.createdAt,
      lastModified: vault.lastModified,
      threshold: vault.threshold,
      totalSigners: vault.totalSigners,
      libType: vault.libType,
      isEncrypted: vault.isEncrypted,
      isBackedUp: vault.isBackedUp,
      chains: vault.getChains().length,
      currency: vault.currency,
      availableSigningModes: vault.availableSigningModes,
    }

    displayStatus(status)
  }

  private async cmdExport(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(chalk.yellow('Use "create" or "import <file>" to add a vault.'))
      return
    }

    const outputPath = args.length > 0 ? args.join(' ') : undefined

    const spinner = createReplSafeSpinner('Exporting vault...').start()

    const { data: vultContent } = await vault.export()
    const fileName = outputPath || `${vault.name}-${vault.localPartyId}-vault.vult`
    await fsPromises.writeFile(fileName, vultContent, 'utf-8')

    spinner.succeed('Vault exported')
    displayExported(fileName)
  }

  // ===== Helper Methods =====

  private getActiveVault(): VaultBase | null {
    if (!this.activeVaultId) return null
    return this.vaults.get(this.activeVaultId) || null
  }

  private setActiveVault(vaultId: string | null): void {
    this.activeVaultId = vaultId
    this.updatePrompt()
  }

  private getPrompt(): string {
    const vault = this.getActiveVault()
    if (!vault) return chalk.cyan('wallet> ')

    const status = vault.isUnlocked() ? chalk.green('🔓') : chalk.yellow('🔒')
    return chalk.cyan(`wallet[${vault.name}]${status}> `)
  }

  private updatePrompt(): void {
    if (this.replServer) {
      this.replServer.setPrompt(this.getPrompt())
    }
  }

  private displayVaultList(): void {
    const vaults = Array.from(this.vaults.values())
    displayVaultList(vaults, this.activeVaultId || undefined)
  }

  private showHelp(): void {
    console.log(chalk.cyan('\n╔════════════════════════════════════════════════╗'))
    console.log(chalk.cyan('║          Available Commands                    ║'))
    console.log(chalk.cyan('╠════════════════════════════════════════════════╣'))
    console.log(chalk.cyan('║') + chalk.bold(' Vault Management:') + '                           ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  vaults              - List all vaults        ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  vault <name>        - Switch to vault        ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  import <file>       - Import vault from file ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  create              - Create new vault       ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '                                                ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + chalk.bold(' Wallet Operations:') + '                          ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  balance [chain]     - Show balances          ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  send <params>       - Send transaction       ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  portfolio           - Show portfolio value   ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  addresses           - Show all addresses     ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  chains              - List/manage chains     ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  tokens <chain>      - List/manage tokens     ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  lock                - Lock vault             ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  unlock              - Unlock vault           ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  status              - Show vault status      ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  export [path]       - Export vault           ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '                                                ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + chalk.bold(' Help & Navigation:') + '                          ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  help, ?             - Show this help         ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '                                                ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + chalk.bold(' Shell Commands:') + '                             ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  .help               - Show this help         ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  .clear              - Clear screen           ' + chalk.cyan('║'))
    console.log(chalk.cyan('║') + '  .exit               - Exit shell             ' + chalk.cyan('║'))
    console.log(chalk.cyan('╚════════════════════════════════════════════════╝\n'))
  }
}
