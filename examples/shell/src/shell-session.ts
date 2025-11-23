import { Chain, fiatCurrencies, FiatCurrency, VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'
import fs from 'fs'
import inquirer from 'inquirer'
import ora from 'ora'
import path from 'path'
import * as repl from 'repl'

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
  handleAddChain,
  handleAddresses,
  handleAddToken,
  handleBalance,
  handleCreateVault,
  handleExport,
  handleImportVault,
  handleListChains,
  handleListTokens,
  handleLock,
  handlePortfolio,
  handleRemoveChain,
  handleRemoveToken,
  handleSend,
  handleStatus,
  handleUnlock,
  handleVerifyVault,
} from './commands'
import { CommandExecutor } from './utils/command-executor'
import { EventManager } from './utils/event-manager'
import { TransactionManager } from './utils/transaction'
import { VaultManager } from './utils/wallet'

/**
 * REPL Session - Interactive wallet using Node.js REPL module
 *
 * This solves all the readline issues:
 * - Empty input (pressing Enter) works perfectly
 * - No complex workarounds needed
 * - Built-in command history
 * - Proper async command support
 */
export class ReplSession {
  private vaultManager: VaultManager
  private vaults: Map<string, VaultBase> = new Map()
  private transactionManagers: Map<string, TransactionManager> = new Map()
  private activeVaultId: string | null = null
  private replServer!: repl.REPLServer
  private lastCommand: string = ''
  private commandExecutor: CommandExecutor
  private eventManager: EventManager

  constructor(vaultManager: VaultManager) {
    this.vaultManager = vaultManager
    this.commandExecutor = new CommandExecutor()
    this.eventManager = new EventManager()
  }

  /**
   * Start the REPL session
   */
  async start(): Promise<void> {
    console.clear()
    console.log(
      chalk.cyan.bold('\n═══════════════════════════════════════════')
    )
    console.log(chalk.cyan.bold('       Vultisig Interactive Shell'))
    console.log(
      chalk.cyan.bold('═══════════════════════════════════════════\n')
    )

    // Load all vaults
    await this.loadAllVaults()

    // Display vault list
    this.displayVaultList()

    // Show quick help
    console.log(
      chalk.gray('Type ".help" for available commands, ".exit" to quit\n')
    )

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
  private evalCommand(
    cmd: string,
    context: any,
    filename: string,
    callback: (err: Error | null, result?: any) => void
  ): void {
    const input = cmd.trim()

    // Handle empty input - REPL handles this naturally!
    if (!input) {
      callback(null)
      return
    }

    // Track the last command for tab completion context
    this.lastCommand = input

    // Parse command and arguments
    const [command, ...args] = input.split(/\s+/)

    // Handle the async commands properly
    const executeCommand = async () => {
      // Start command execution - buffer events during command
      this.eventManager.startCommand()

      // Execute commands through CommandExecutor for consistent error handling
      await this.commandExecutor.execute(async () => {
        // Handle non-dot commands
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

    // Execute the command and call callback when done
    executeCommand()
      .then(() => {
        // End command execution - flush buffered events
        this.eventManager.endCommand()
        // Ensure prompt is updated before REPL shows next prompt
        this.replServer.setPrompt(this.getPrompt())
        callback(null)
      })
      .catch(error => {
        // End command execution even on error - flush buffered events
        this.eventManager.endCommand()
        console.error(chalk.red(`✗ Error: ${error.message}`))
        this.replServer.setPrompt(this.getPrompt())
        callback(null)
      })
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
        // Store context for file completion
        this.lastCommand = command
        return this.completeFilePath(partial)
      }

      // If we're typing after chains --add or chains --remove, provide chain completion
      if (command === 'chains' && parts.length >= 2) {
        const flag = parts[parts.length - 2]?.toLowerCase()
        if (flag === '--add' || flag === '--remove') {
          const partial = parts[parts.length - 1] || ''
          return this.completeChainName(partial)
        }
        // If just typed --add or --remove, show all chains
        if (
          parts[parts.length - 1]?.toLowerCase() === '--add' ||
          parts[parts.length - 1]?.toLowerCase() === '--remove'
        ) {
          return this.completeChainName('')
        }
      }

      // Otherwise, complete commands
      const hits = commands.filter(c => c.startsWith(line))

      // Show all commands if no input
      const show = hits.length ? hits : commands

      return [show, line]
    } catch (_error) {
      // Return empty completions on error
      console.error('Tab completion error:', _error)
      return [[], line]
    }
  }

  /**
   * File path completion helper
   */
  private completeFilePath(partial: string): [string[], string] {
    try {
      // Check if partial ends with a path separator (showing directory contents)
      const endsWithSeparator =
        partial.endsWith('/') || partial.endsWith(path.sep)

      // Handle relative paths like ../../
      let dir: string
      let basename: string

      if (endsWithSeparator) {
        // If ends with separator, we want to show contents of that directory
        dir = partial
        basename = ''
      } else {
        // Otherwise, split into directory and basename
        dir = path.dirname(partial)
        basename = path.basename(partial)

        // Special case: if partial is just a directory name without separator
        if (fs.existsSync(partial) && fs.statSync(partial).isDirectory()) {
          dir = partial
          basename = ''
        }
      }

      // Resolve the directory path
      const resolvedDir = path.resolve(dir)

      // Read directory contents
      if (
        !fs.existsSync(resolvedDir) ||
        !fs.statSync(resolvedDir).isDirectory()
      ) {
        return [[], partial]
      }

      const files = fs.readdirSync(resolvedDir)

      // Filter files that match the partial basename
      const matches = files
        .filter((file: string) => file.startsWith(basename))
        .map((file: string) => {
          const fullPath = path.join(dir, file)
          const stats = fs.statSync(path.join(resolvedDir, file))

          // Add trailing slash for directories
          if (stats.isDirectory()) {
            return fullPath + '/'
          }

          // For import command, only show .vult files and directories
          const isImportCommand = this.lastCommand
            ?.toLowerCase()
            .startsWith('import')
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
      // Return empty completions on error
      return [[], partial]
    }
  }

  /**
   * Chain name completion helper (case-insensitive)
   */
  private completeChainName(partial: string): [string[], string] {
    // Get all available chain names from the Chain object
    const allChains = Object.values(Chain) as string[]

    // Case-insensitive filtering
    const partialLower = partial.toLowerCase()
    const matches = allChains.filter((chain: string) =>
      chain.toLowerCase().startsWith(partialLower)
    )

    // Sort matches alphabetically for better UX
    matches.sort()

    // Show all chains if no matches or empty input
    const show = matches.length > 0 ? matches : allChains.sort()

    return [show, partial]
  }

  /**
   * Find a chain by name (case-insensitive)
   */
  private findChainByName(name: string): Chain | null {
    const allChains = Object.values(Chain) as string[]
    const nameLower = name.toLowerCase()
    const found = allChains.find(
      (chain: string) => chain.toLowerCase() === nameLower
    )
    return found ? (found as Chain) : null
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
    // Setup all vault event listeners through the centralized EventManager
    // Events are buffered during command execution and displayed after completion
    this.eventManager.setupVaultListeners(vault)

    // Keep the unlocked event for prompt updates (doesn't display anything)
    vault.on('unlocked', () => {
      // Just update the prompt to show the unlock icon
      this.updatePrompt()
    })
  }

  /**
   * Load all vaults from storage
   */
  private async loadAllVaults(): Promise<void> {
    const spinner = ora('Loading vaults...').start()

    try {
      // First check if VaultManager has an active vault
      const activeVault = this.vaultManager.getActiveVault()
      if (activeVault) {
        this.vaults.set(activeVault.id, activeVault)
        this.transactionManagers.set(
          activeVault.id,
          new TransactionManager(activeVault)
        )
        this.setActiveVault(activeVault.id)
      }

      // Then load all vaults from storage
      const vaultList = await this.vaultManager.getAllVaults()

      if (vaultList && vaultList.length > 0) {
        vaultList.forEach(vault => {
          // Don't overwrite if already loaded above
          if (!this.vaults.has(vault.id)) {
            this.vaults.set(vault.id, vault)
            this.transactionManagers.set(
              vault.id,
              new TransactionManager(vault)
            )
          }
        })

        // Set first vault as active if not already set
        if (!this.activeVaultId && this.vaults.size > 0) {
          this.setActiveVault(this.vaults.keys().next().value)
        }
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else if (this.vaults.size > 0) {
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else {
        spinner.succeed('No vaults found')
      }
    } catch {
      if (this.vaults.size > 0) {
        spinner.succeed(`Loaded ${this.vaults.size} vault(s)`)
      } else {
        spinner.succeed('No vaults found')
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
      console.log(chalk.yellow('Usage: vault <number>'))
      console.log(chalk.gray('Run "vaults" to see available vaults'))
      return
    }

    const index = parseInt(args[0]) - 1
    const vaults = Array.from(this.vaults.values())

    if (index < 0 || index >= vaults.length) {
      console.log(chalk.red('Invalid vault number'))
      return
    }

    const vault = vaults[index]
    this.setActiveVault(vault.id)

    console.log(chalk.green(`Switched to: ${vault.name}`))
    const status = vault.isUnlocked()
      ? chalk.green('Unlocked 🔓')
      : chalk.yellow('Locked 🔒')
    console.log(`Status: ${status}`)
  }

  private async cmdImport(args: string[]): Promise<void> {
    if (args.length === 0) {
      console.log(chalk.yellow('Usage: import <file>'))
      return
    }

    // Join all args to handle file paths with spaces
    const filePath = args.join(' ')

    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter vault password (if encrypted):',
        mask: '*',
      },
    ])

    const spinner = ora('Importing vault...').start()

    const sdk = this.vaultManager.getSDK()
    const vault = await handleImportVault(sdk, filePath, password || undefined)

    this.vaults.set(vault.id, vault)
    this.transactionManagers.set(vault.id, new TransactionManager(vault))
    this.setupVaultEventListeners(vault)

    // Make the imported vault active
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
        validate: (input: string) =>
          input.length >= 8 || 'Password must be at least 8 characters',
      },
      {
        type: 'password',
        name: 'confirmPassword',
        message: 'Confirm password:',
        mask: '*',
        validate: (input: string, answers: any) =>
          input === answers.password || 'Passwords do not match',
      },
      {
        type: 'input',
        name: 'email',
        message: 'Enter email for verification:',
        validate: (input: string) =>
          /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
      },
    ])) as any

    const sdk = this.vaultManager.getSDK()
    const result = await handleCreateVault(
      sdk,
      answers.name,
      answers.password,
      answers.email
    )

    this.vaults.set(result.vault.id, result.vault)
    this.transactionManagers.set(
      result.vault.id,
      new TransactionManager(result.vault)
    )
    this.setupVaultEventListeners(result.vault)

    // Make the created vault active
    this.setActiveVault(result.vault.id)

    if (result.verificationRequired) {
      console.log(
        chalk.yellow('\n📧 A verification code has been sent to your email.')
      )
      console.log(chalk.blue('Please check your inbox and enter the code.'))

      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: `Verification code sent to ${answers.email}. Enter code:`,
          validate: (input: string) =>
            /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
        },
      ])

      const verified = await handleVerifyVault(sdk, result.vaultId, code)

      if (!verified) {
        console.error(
          chalk.red(
            '\n✗ Verification failed. Please check the code and try again.'
          )
        )
        return
      }
    }

    displayVaultCreated(result.vault.name)
  }

  private async cmdBalance(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    const chainStr = args[0]
    const includeTokens = args.includes('-t') || args.includes('--tokens')

    const spinner = ora('Loading balances...').start()

    const result = await handleBalance(vault, chainStr, {
      tokens: includeTokens,
    })
    spinner.succeed('Balances loaded')
    displayBalances(result, chainStr)
  }

  private async cmdSend(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    if (args.length < 3) {
      console.log(
        chalk.yellow(
          'Usage: send <chain> <to> <amount> [--token <tokenId>] [--memo <memo>]'
        )
      )
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
        // Join all remaining args after --memo to support memos with spaces
        memo = rest.slice(i + 1).join(' ')
        break // memo should be the last parameter
      }
    }

    const transactionManager = this.transactionManagers.get(vault.id)
    if (!transactionManager) {
      throw new Error('Transaction manager not initialized')
    }

    const result = await handleSend(transactionManager, {
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
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    let currency: FiatCurrency = 'usd'
    for (let i = 0; i < args.length; i++) {
      if (
        (args[i] === '-c' || args[i] === '--currency') &&
        i + 1 < args.length
      ) {
        currency = args[i + 1].toLowerCase() as FiatCurrency
        i++
      }
    }

    if (!fiatCurrencies.includes(currency)) {
      console.log(chalk.red(`Invalid currency: ${currency}`))
      console.log(
        chalk.yellow(`Supported currencies: ${fiatCurrencies.join(', ')}`)
      )
      return
    }

    // Check if vault has any chains
    const chains = vault.getChains()
    if (chains.length === 0) {
      console.log(chalk.yellow('\nNo chains added to this vault yet.'))
      console.log(
        chalk.gray('Use "chains --add <chain>" to add a chain first.')
      )
      return
    }

    const spinner = ora('Loading portfolio...').start()

    const portfolio = await handlePortfolio(vault, currency)
    spinner.succeed('Portfolio loaded')
    displayPortfolio(portfolio, currency)
  }

  private async cmdAddresses(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    const spinner = ora('Loading addresses...').start()

    const addresses = await handleAddresses(vault)
    spinner.succeed('Addresses loaded')
    displayAddresses(addresses)
  }

  private async cmdChains(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
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
      // Find the matching chain name (case-insensitive)
      const chain = this.findChainByName(addChain)
      if (!chain) {
        console.error(chalk.red(`Unknown chain: ${addChain}`))
        console.log(chalk.gray('Use tab completion to see available chains'))
        return
      }
      const address = await handleAddChain(vault, chain)
      displayChainAdded(chain, address)
    } else if (removeChain) {
      // Find the matching chain name (case-insensitive)
      const chain = this.findChainByName(removeChain)
      if (!chain) {
        console.error(chalk.red(`Unknown chain: ${removeChain}`))
        console.log(chalk.gray('Use tab completion to see available chains'))
        return
      }
      await handleRemoveChain(vault, chain)
      displayChainRemoved(chain)
    } else {
      const chains = handleListChains(vault)
      displayChains(chains)
    }
  }

  private async cmdTokens(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    // Parse arguments
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
        // First positional arg is chain
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
      // Add token
      if (!symbol) {
        console.log(chalk.red('Symbol is required when adding a token'))
        console.log(
          chalk.gray(
            'Usage: tokens <chain> --add <address> --symbol <symbol> [--decimals <decimals>]'
          )
        )
        return
      }

      const token = {
        contractAddress: addAddress,
        symbol,
        decimals: decimals || 18,
        isNativeToken: false,
      }

      await handleAddToken(vault, chainEnum, token)
      displayTokenAdded(chainEnum, symbol)
    } else if (removeTokenId) {
      // Remove token
      await handleRemoveToken(vault, chainEnum, removeTokenId)
      displayTokenRemoved(chainEnum, removeTokenId)
    } else {
      // List tokens
      const tokens = handleListTokens(vault, chainEnum)
      displayTokens(chainEnum, tokens)
    }
  }

  private async cmdLock(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    handleLock(vault)
    displayLocked()
    this.updatePrompt()
  }

  private async cmdUnlock(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
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

    const spinner = ora('Unlocking vault...').start()

    const result = await handleUnlock(vault, password)
    spinner.succeed('Vault unlocked')
    displayUnlocked(result.timeRemainingFormatted)
    this.updatePrompt()
  }

  private async cmdStatus(): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    const status = handleStatus(vault)
    displayStatus(status)
  }

  private async cmdExport(args: string[]): Promise<void> {
    const vault = this.getActiveVault()
    if (!vault) {
      console.log(chalk.red('No active vault.'))
      console.log(
        chalk.yellow('Use "create" or "import <file>" to add a vault.')
      )
      return
    }

    // Join all args to handle file paths with spaces
    const outputPath = args.length > 0 ? args.join(' ') : undefined

    const spinner = ora('Exporting vault...').start()

    const fileName = await handleExport(vault, outputPath)
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
      // Don't call displayPrompt here - let the REPL handle prompt display
    }
  }

  private displayVaultList(): void {
    const vaults = Array.from(this.vaults.values())
    displayVaultList(vaults, this.activeVaultId || undefined)
  }

  private showHelp(): void {
    console.log(
      chalk.cyan('\n╔════════════════════════════════════════════════╗')
    )
    console.log(
      chalk.cyan('║          Available Commands                    ║')
    )
    console.log(
      chalk.cyan('╠════════════════════════════════════════════════╣')
    )
    console.log(
      chalk.cyan('║') +
        chalk.bold(' Vault Management:') +
        '                           ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  vaults              - List all vaults        ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  vault <number>      - Switch to vault        ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  import <file>       - Import vault from file ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  create              - Create new vault       ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '                                                ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        chalk.bold(' Wallet Operations:') +
        '                          ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  balance [chain]     - Show balances          ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  send <params>       - Send transaction       ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  portfolio           - Show portfolio value   ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  addresses           - Show all addresses     ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  chains              - List/manage chains     ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  tokens <chain>      - List/manage tokens     ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  lock                - Lock vault             ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  unlock              - Unlock vault           ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  status              - Show vault status      ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  export [path]       - Export vault           ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '                                                ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        chalk.bold(' Help & Navigation:') +
        '                          ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  help, ?             - Show this help         ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '                                                ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        chalk.bold(' Shell Commands:') +
        '                             ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  .help               - Show this help         ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  .clear              - Clear screen           ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('║') +
        '  .exit               - Exit shell             ' +
        chalk.cyan('║')
    )
    console.log(
      chalk.cyan('╚════════════════════════════════════════════════╝\n')
    )
  }
}
