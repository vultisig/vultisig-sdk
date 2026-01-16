/**
 * Vault Management Commands - create, import, export, verify, switch, rename, info, vaults
 */
import type { Chain, VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'
import path from 'path'
import qrcode from 'qrcode-terminal'

import type { CommandContext } from '../core'
import {
  createSpinner,
  error,
  info,
  isJsonOutput,
  isSilent,
  outputJson,
  printResult,
  success,
  warn,
} from '../lib/output'
import { displayVaultInfo, displayVaultsList, setupVaultEvents } from '../ui'

/**
 * Race a promise against an abort signal
 */
function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      if (signal.aborted) reject(new Error('Operation cancelled'))
      signal.addEventListener('abort', () => reject(new Error('Operation cancelled')), { once: true })
    }),
  ])
}

export type FastVaultOptions = {
  name: string
  password: string
  email: string
  signal?: AbortSignal
}

export type SecureVaultOptions = {
  name: string
  password?: string
  threshold: number
  shares: number
  signal?: AbortSignal
}

/**
 * Create a fast vault (server-assisted 2-of-2)
 */
export async function executeCreateFast(ctx: CommandContext, options: FastVaultOptions): Promise<VaultBase> {
  const { name, password, email, signal } = options

  const spinner = createSpinner('Creating vault...')

  // createFastVault returns just the vaultId - vault is returned from verifyVault
  const vaultId = await withAbortSignal(
    ctx.sdk.createFastVault({
      name,
      password,
      email: email!,
      onProgress: step => {
        spinner.text = `${step.message} (${step.progress}%)`
      },
    }),
    signal
  )

  spinner.succeed(`Vault keys generated: ${name}`)

  // Fast vaults always require email verification
  warn('\nA verification code has been sent to your email.')
  info('Please check your inbox and enter the code.')

  const MAX_VERIFY_ATTEMPTS = 5
  let attempts = 0

  while (attempts < MAX_VERIFY_ATTEMPTS) {
    attempts++

    const codeAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'code',
        message: `Verification code sent to ${email}. Enter code:`,
        validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
      },
    ])

    const verifySpinner = createSpinner('Verifying email code...')

    try {
      const vault = await ctx.sdk.verifyVault(vaultId, codeAnswer.code)
      verifySpinner.succeed('Email verified successfully!')

      setupVaultEvents(vault)
      await ctx.setActiveVault(vault)

      success('\n+ Vault created!')
      info('\nYour vault is ready. Run the following commands:')
      printResult(chalk.cyan('  vultisig balance     ') + '- View balances')
      printResult(chalk.cyan('  vultisig addresses   ') + '- View addresses')
      printResult(chalk.cyan('  vultisig portfolio   ') + '- View portfolio value')

      return vault
    } catch (err: any) {
      verifySpinner.fail('Verification failed')
      error(`\n✗ ${err.message || 'Invalid verification code'}`)

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        warn('\nMaximum attempts reached.')
        warn('\nTo retry verification later, use:')
        info(`  vultisig verify ${vaultId}`)
        err.exitCode = 1
        throw err
      }

      // Offer retry options
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `What would you like to do? (${MAX_VERIFY_ATTEMPTS - attempts} attempts remaining)`,
          choices: [
            { name: 'Enter a different code', value: 'retry' },
            { name: 'Resend verification email (rate limited)', value: 'resend' },
            { name: 'Abort and verify later', value: 'abort' },
          ],
        },
      ])

      if (action === 'abort') {
        warn('\nVault creation paused. To complete verification, use:')
        info(`  vultisig verify ${vaultId}`)
        warn('\nNote: The pending vault is stored in memory only and will be lost if you exit.')
        return undefined as any
      }

      if (action === 'resend') {
        const resendSpinner = createSpinner('Resending verification email...')
        try {
          await ctx.sdk.resendVaultVerification({ vaultId, email: email!, password })
          resendSpinner.succeed('Verification email sent!')
          info('Check your inbox for the new code. Note: There may be a ~3 minute cooldown between resends.')
        } catch (resendErr: any) {
          resendSpinner.fail('Failed to resend')
          warn(resendErr.message || 'Could not resend email. You may need to wait a few minutes.')
        }
      }
      // Continue loop for retry
    }
  }

  // This should never be reached, but TypeScript needs it
  throw new Error('Verification loop exited unexpectedly')
}

/**
 * Create a secure vault (multi-device MPC)
 */
export async function executeCreateSecure(ctx: CommandContext, options: SecureVaultOptions): Promise<VaultBase> {
  const { name, password, threshold, shares: totalShares, signal } = options

  const spinner = createSpinner('Creating secure vault...')

  try {
    const result = await withAbortSignal(
      ctx.sdk.createSecureVault({
        name,
        password,
        devices: totalShares,
        threshold,
        onProgress: step => {
          spinner.text = `${step.message} (${step.progress}%)`
        },
        onQRCodeReady: qrPayload => {
          if (isJsonOutput()) {
            // JSON mode: Print QR URL immediately for scripting
            printResult(qrPayload)
          } else if (isSilent()) {
            // Silent mode: Print URL only
            printResult(`QR Payload: ${qrPayload}`)
          } else {
            // Interactive: Display ASCII QR code
            spinner.stop()
            info('\nScan this QR code with your Vultisig mobile app:')
            qrcode.generate(qrPayload, { small: true })
            info(`\nOr use this URL: ${qrPayload}\n`)
            info(chalk.gray('(Press Ctrl+C to cancel)\n'))
            spinner.start(`Waiting for ${totalShares} devices to join...`)
          }
        },
        onDeviceJoined: (deviceId, totalJoined, required) => {
          if (!isSilent()) {
            spinner.text = `Device joined: ${totalJoined}/${required} (${deviceId})`
          } else if (!isJsonOutput()) {
            printResult(`Device joined: ${totalJoined}/${required}`)
          }
        },
      }),
      signal
    )

    setupVaultEvents(result.vault)
    await ctx.setActiveVault(result.vault)
    spinner.succeed(`Secure vault created: ${name} (${threshold}-of-${totalShares})`)

    // JSON mode: output structured data
    if (isJsonOutput()) {
      outputJson({
        vault: {
          id: result.vaultId,
          name: name,
          type: 'secure',
          threshold: threshold,
          totalSigners: totalShares,
        },
        sessionId: result.sessionId,
      })
      return result.vault
    }

    warn(`\nImportant: Save your vault backup file (.vult) in a secure location.`)
    warn(`This is a ${threshold}-of-${totalShares} vault. You'll need ${threshold} devices to sign transactions.`)

    success('\n+ Vault created!')

    return result.vault
  } catch (err: any) {
    spinner.fail('Secure vault creation failed')
    if (err.message?.includes('not implemented')) {
      warn('\nSecure vault creation is not yet implemented in the SDK')
    }
    throw err
  }
}

/**
 * Execute import vault command
 */
export async function executeImport(ctx: CommandContext, file: string): Promise<VaultBase> {
  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: 'Enter vault password (if encrypted):',
      mask: '*',
    },
  ])

  const spinner = createSpinner('Importing vault...')

  const vultContent = await fs.readFile(file, 'utf-8')
  const vault = await ctx.sdk.importVault(vultContent, password || undefined)

  setupVaultEvents(vault)
  await ctx.setActiveVault(vault)
  spinner.succeed(`Vault imported: ${vault.name}`)

  success('\n+ Vault imported successfully!')
  info('\nRun "vultisig balance" to view balances')

  return vault
}

/**
 * Execute verify vault command
 *
 * Note: This command is for re-verifying a vault after initial creation failed.
 * It requires that the vault was created in the current session (pending in memory).
 */
export async function executeVerify(
  ctx: CommandContext,
  vaultId: string,
  options: { resend?: boolean; code?: string; email?: string; password?: string } = {}
): Promise<boolean> {
  if (options.resend) {
    // Get email and password - prompt if not provided via flags
    let email = options.email
    let password = options.password

    if (!email || !password) {
      info('Email and password are required to resend verification.')
      const answers = await inquirer.prompt([
        ...(!email
          ? [
              {
                type: 'input',
                name: 'email',
                message: 'Email address:',
                validate: (input: string) => input.includes('@') || 'Please enter a valid email',
              },
            ]
          : []),
        ...(!password
          ? [
              {
                type: 'password',
                name: 'password',
                message: 'Vault password:',
                mask: '*',
                validate: (input: string) => input.length >= 8 || 'Password must be at least 8 characters',
              },
            ]
          : []),
      ])
      email = email || answers.email
      password = password || answers.password
    }

    const spinner = createSpinner('Resending verification email...')
    try {
      await ctx.sdk.resendVaultVerification({ vaultId, email: email!, password: password! })
      spinner.succeed('Verification email sent!')
      info('Check your inbox for the new verification code.')
    } catch (resendErr: any) {
      spinner.fail('Failed to resend verification email')
      error(resendErr.message || 'Could not resend email. You may need to wait a few minutes.')
      return false
    }
  }

  let code = options.code

  if (!code) {
    const codeAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'code',
        message: 'Enter verification code:',
        validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
      },
    ])
    code = codeAnswer.code
  }

  const spinner = createSpinner('Verifying email code...')

  try {
    // verifyVault now returns the vault directly (throws on failure)
    const vault = await ctx.sdk.verifyVault(vaultId, code!)
    spinner.succeed('Vault verified successfully!')

    setupVaultEvents(vault)
    await ctx.setActiveVault(vault)

    success(`\n+ Vault "${vault.name}" is now ready to use!`)
    return true
  } catch (err: any) {
    spinner.fail('Verification failed')
    error(`\n✗ ${err.message || 'Verification failed. Please check the code and try again.'}`)
    warn('\nTip: Use --resend to get a new verification code:')
    info(`  vultisig verify ${vaultId} --resend`)
    return false
  }
}

export type ExportVaultOptions = {
  outputPath?: string
  password?: string // Vault unlock password (already cached by init)
  exportPassword?: string // Export file encryption password
}

/**
 * Execute export vault command
 */
export async function executeExport(ctx: CommandContext, options: ExportVaultOptions = {}): Promise<string> {
  const vault = await ctx.ensureActiveVault()

  // Determine export password with fallback logic:
  // 1. Use --exportPassword if provided
  // 2. Else use --password if provided (same password for both unlock and export)
  // 3. Else prompt for export password
  let exportPassword = options.exportPassword
  if (exportPassword === undefined) {
    if (options.password !== undefined) {
      // Default: use unlock password for export encryption too
      exportPassword = options.password
    } else {
      // Prompt for export password
      const answer = await inquirer.prompt([
        {
          type: 'password',
          name: 'exportPassword',
          message: 'Enter password for export encryption (leave empty for no encryption):',
          mask: '*',
        },
      ])
      exportPassword = answer.exportPassword || undefined // empty string → undefined
    }
  }

  const spinner = createSpinner('Exporting vault...')

  // Pass export password to SDK - encrypts if password is provided
  const { data: vultContent, filename: sdkFilename } = await vault.export(exportPassword)

  // Determine output path
  let outputPath: string
  if (options.outputPath) {
    const resolvedPath = path.resolve(options.outputPath)
    // Check if path is a directory - if so, append the SDK filename
    try {
      const stat = await fs.stat(resolvedPath)
      if (stat.isDirectory()) {
        outputPath = path.join(resolvedPath, sdkFilename)
      } else {
        outputPath = resolvedPath
      }
    } catch {
      // Path doesn't exist yet, use as-is (could be a new file path)
      outputPath = resolvedPath
    }
  } else {
    outputPath = path.resolve(sdkFilename)
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(outputPath)
  await fs.mkdir(parentDir, { recursive: true })

  // Write the vault file
  await fs.writeFile(outputPath, vultContent, 'utf-8')

  spinner.succeed(`Vault exported: ${outputPath}`)

  success('\n+ Vault exported successfully!')
  info(`File: ${outputPath}`)

  return outputPath
}

/**
 * Execute list vaults command
 */
export async function executeVaults(ctx: CommandContext): Promise<VaultBase[]> {
  const spinner = createSpinner('Loading vaults...')
  const vaults = await ctx.sdk.listVaults()
  spinner.succeed('Vaults loaded')

  if (isJsonOutput()) {
    const activeVault = ctx.getActiveVault()
    outputJson({
      vaults: vaults.map(v => ({
        id: v.id,
        name: v.name,
        type: v.type,
        chains: v.chains.length,
        createdAt: v.createdAt,
        isActive: activeVault?.id === v.id,
      })),
    })
    return vaults
  }

  if (vaults.length === 0) {
    warn('\nNo vaults found. Create or import a vault first.')
    return []
  }

  const activeVault = ctx.getActiveVault()
  displayVaultsList(vaults, activeVault)

  info(chalk.gray('\nUse "vultisig switch <id>" to switch active vault'))

  return vaults
}

/**
 * Execute switch vault command
 */
export async function executeSwitch(ctx: CommandContext, vaultId: string): Promise<VaultBase> {
  const spinner = createSpinner('Loading vault...')
  const vault = await ctx.sdk.getVaultById(vaultId)

  if (!vault) {
    spinner.fail('Vault not found')
    throw new Error(`No vault found with ID: ${vaultId}`)
  }

  await ctx.setActiveVault(vault)
  setupVaultEvents(vault)
  spinner.succeed('Vault switched')

  success(`\n+ Switched to vault: ${vault.name}`)
  info(`  Type: ${vault.type}`)
  info(`  Chains: ${vault.chains.length}`)

  return vault
}

/**
 * Execute rename vault command
 */
export async function executeRename(ctx: CommandContext, newName: string): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  const oldName = vault.name

  const spinner = createSpinner('Renaming vault...')
  await vault.rename(newName)
  spinner.succeed('Vault renamed')

  success(`\n+ Vault renamed from "${oldName}" to "${newName}"`)
}

/**
 * Execute vault info command
 */
export async function executeInfo(ctx: CommandContext): Promise<void> {
  const vault = await ctx.ensureActiveVault()

  if (isJsonOutput()) {
    outputJson({
      vault: {
        id: vault.id,
        name: vault.name,
        type: vault.type,
        createdAt: vault.createdAt,
        lastModified: vault.lastModified,
        isEncrypted: vault.isEncrypted,
        isBackedUp: vault.isBackedUp,
        libType: vault.libType,
        threshold: vault.threshold,
        totalSigners: vault.totalSigners,
        localPartyId: vault.localPartyId,
        availableSigningModes: [...vault.availableSigningModes],
        chains: [...vault.chains],
        currency: vault.currency,
        publicKeys: {
          ecdsa: vault.publicKeys.ecdsa,
          eddsa: vault.publicKeys.eddsa,
          chainCode: vault.hexChainCode,
        },
      },
    })
    return
  }

  displayVaultInfo(vault)
}

// ============================================================================
// Seedphrase Import Commands
// ============================================================================

export type ImportSeedphraseFastOptions = {
  mnemonic: string
  name: string
  password: string
  email: string
  discoverChains?: boolean
  chains?: Chain[]
  signal?: AbortSignal
}

export type ImportSeedphraseSecureOptions = {
  mnemonic: string
  name: string
  password?: string
  threshold: number
  shares: number
  discoverChains?: boolean
  chains?: Chain[]
  signal?: AbortSignal
}

/**
 * Import seedphrase as FastVault (server-assisted 2-of-2)
 */
export async function executeImportSeedphraseFast(
  ctx: CommandContext,
  options: ImportSeedphraseFastOptions
): Promise<VaultBase> {
  const { mnemonic, name, password, email, discoverChains, chains, signal } = options

  // 1. Validate seedphrase first
  const validateSpinner = createSpinner('Validating seedphrase...')
  const validation = await ctx.sdk.validateSeedphrase(mnemonic)
  if (!validation.valid) {
    validateSpinner.fail('Invalid seedphrase')
    if (validation.invalidWords?.length) {
      warn(`Invalid words: ${validation.invalidWords.join(', ')}`)
    }
    throw new Error(validation.error || 'Invalid mnemonic phrase')
  }
  validateSpinner.succeed(`Valid ${validation.wordCount}-word seedphrase`)

  // 2. Optional chain discovery (runs if --discover-chains is set)
  if (discoverChains) {
    const discoverSpinner = createSpinner('Discovering chains with balances...')
    try {
      // If --chains specified, only scan those; otherwise scan all
      const discovered = await ctx.sdk.discoverChainsFromSeedphrase(mnemonic, chains, p => {
        discoverSpinner.text = `Discovering: ${p.chain || 'scanning'} (${p.chainsProcessed}/${p.chainsTotal})`
      })
      const chainsWithBalance = discovered.filter(c => c.hasBalance)
      discoverSpinner.succeed(`Found ${chainsWithBalance.length} chains with balances`)

      if (chainsWithBalance.length > 0 && !isSilent()) {
        info('\nChains with balances:')
        for (const result of chainsWithBalance) {
          info(`  ${result.chain}: ${result.balance} ${result.symbol}`)
        }
        info('')
      }
    } catch {
      discoverSpinner.warn('Chain discovery failed, continuing with import...')
    }
  }

  // 3. Import via SDK (discovery already handled by CLI above)
  const importSpinner = createSpinner('Importing seedphrase...')
  const vaultId = await withAbortSignal(
    ctx.sdk.importSeedphraseAsFastVault({
      mnemonic,
      name,
      password,
      email,
      // Don't pass discoverChains - CLI handles discovery above
      chains,
      onProgress: step => {
        importSpinner.text = `${step.message} (${step.progress}%)`
      },
    }),
    signal
  )
  importSpinner.succeed('Keys generated, email verification required')

  // 4. Email verification flow (same as executeCreateFast)
  warn('\nA verification code has been sent to your email.')
  info('Please check your inbox and enter the code.')

  const MAX_VERIFY_ATTEMPTS = 5
  let attempts = 0

  while (attempts < MAX_VERIFY_ATTEMPTS) {
    attempts++

    const codeAnswer = await inquirer.prompt([
      {
        type: 'input',
        name: 'code',
        message: `Verification code sent to ${email}. Enter code:`,
        validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
      },
    ])

    const verifySpinner = createSpinner('Verifying email code...')

    try {
      const vault = await ctx.sdk.verifyVault(vaultId, codeAnswer.code)
      verifySpinner.succeed('Email verified successfully!')

      setupVaultEvents(vault)
      await ctx.setActiveVault(vault)

      success('\n+ Vault imported from seedphrase!')
      info('\nYour vault is ready. Run the following commands:')
      printResult(chalk.cyan('  vultisig balance     ') + '- View balances')
      printResult(chalk.cyan('  vultisig addresses   ') + '- View addresses')
      printResult(chalk.cyan('  vultisig portfolio   ') + '- View portfolio value')

      return vault
    } catch (err: any) {
      verifySpinner.fail('Verification failed')
      error(`\n✗ ${err.message || 'Invalid verification code'}`)

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        warn('\nMaximum attempts reached.')
        warn('\nTo retry verification later, use:')
        info(`  vultisig verify ${vaultId}`)
        err.exitCode = 1
        throw err
      }

      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: `What would you like to do? (${MAX_VERIFY_ATTEMPTS - attempts} attempts remaining)`,
          choices: [
            { name: 'Enter a different code', value: 'retry' },
            { name: 'Resend verification email (rate limited)', value: 'resend' },
            { name: 'Abort and verify later', value: 'abort' },
          ],
        },
      ])

      if (action === 'abort') {
        warn('\nSeedphrase import paused. To complete verification, use:')
        info(`  vultisig verify ${vaultId}`)
        warn('\nNote: The pending vault is stored in memory only and will be lost if you exit.')
        return undefined as any
      }

      if (action === 'resend') {
        const resendSpinner = createSpinner('Resending verification email...')
        try {
          await ctx.sdk.resendVaultVerification({ vaultId, email, password })
          resendSpinner.succeed('Verification email sent!')
          info('Check your inbox for the new code.')
        } catch (resendErr: any) {
          resendSpinner.fail('Failed to resend')
          warn(resendErr.message || 'Could not resend email.')
        }
      }
    }
  }

  throw new Error('Verification loop exited unexpectedly')
}

/**
 * Import seedphrase as SecureVault (multi-device MPC)
 */
export async function executeImportSeedphraseSecure(
  ctx: CommandContext,
  options: ImportSeedphraseSecureOptions
): Promise<VaultBase> {
  const { mnemonic, name, password, threshold, shares: totalShares, discoverChains, chains, signal } = options

  // 1. Validate seedphrase first
  const validateSpinner = createSpinner('Validating seedphrase...')
  const validation = await ctx.sdk.validateSeedphrase(mnemonic)
  if (!validation.valid) {
    validateSpinner.fail('Invalid seedphrase')
    if (validation.invalidWords?.length) {
      warn(`Invalid words: ${validation.invalidWords.join(', ')}`)
    }
    throw new Error(validation.error || 'Invalid mnemonic phrase')
  }
  validateSpinner.succeed(`Valid ${validation.wordCount}-word seedphrase`)

  // 2. Optional chain discovery (runs if --discover-chains is set)
  if (discoverChains) {
    const discoverSpinner = createSpinner('Discovering chains with balances...')
    try {
      // If --chains specified, only scan those; otherwise scan all
      const discovered = await ctx.sdk.discoverChainsFromSeedphrase(mnemonic, chains, p => {
        discoverSpinner.text = `Discovering: ${p.chain || 'scanning'} (${p.chainsProcessed}/${p.chainsTotal})`
      })
      const chainsWithBalance = discovered.filter(c => c.hasBalance)
      discoverSpinner.succeed(`Found ${chainsWithBalance.length} chains with balances`)

      if (chainsWithBalance.length > 0 && !isSilent()) {
        info('\nChains with balances:')
        for (const result of chainsWithBalance) {
          info(`  ${result.chain}: ${result.balance} ${result.symbol}`)
        }
        info('')
      }
    } catch {
      discoverSpinner.warn('Chain discovery failed, continuing with import...')
    }
  }

  // 3. Import via SDK (discovery already handled by CLI above)
  const importSpinner = createSpinner('Importing seedphrase as secure vault...')

  try {
    const result = await withAbortSignal(
      ctx.sdk.importSeedphraseAsSecureVault({
        mnemonic,
        name,
        password,
        devices: totalShares,
        threshold,
        // Don't pass discoverChains - CLI handles discovery above
        chains,
        onProgress: step => {
          importSpinner.text = `${step.message} (${step.progress}%)`
        },
        onQRCodeReady: qrPayload => {
          if (isJsonOutput()) {
            printResult(qrPayload)
          } else if (isSilent()) {
            printResult(`QR Payload: ${qrPayload}`)
          } else {
            importSpinner.stop()
            info('\nScan this QR code with your Vultisig mobile app:')
            qrcode.generate(qrPayload, { small: true })
            info(`\nOr use this URL: ${qrPayload}\n`)
            info(chalk.gray('(Press Ctrl+C to cancel)\n'))
            importSpinner.start(`Waiting for ${totalShares} devices to join...`)
          }
        },
        onDeviceJoined: (deviceId, totalJoined, required) => {
          if (!isSilent()) {
            importSpinner.text = `Device joined: ${totalJoined}/${required} (${deviceId})`
          } else if (!isJsonOutput()) {
            printResult(`Device joined: ${totalJoined}/${required}`)
          }
        },
      }),
      signal
    )

    setupVaultEvents(result.vault)
    await ctx.setActiveVault(result.vault)
    importSpinner.succeed(`Secure vault imported: ${name} (${threshold}-of-${totalShares})`)

    if (isJsonOutput()) {
      outputJson({
        vault: {
          id: result.vaultId,
          name: name,
          type: 'secure',
          threshold: threshold,
          totalSigners: totalShares,
        },
        sessionId: result.sessionId,
      })
      return result.vault
    }

    warn(`\nImportant: Save your vault backup file (.vult) in a secure location.`)
    warn(`This is a ${threshold}-of-${totalShares} vault. You'll need ${threshold} devices to sign transactions.`)

    success('\n+ Vault imported from seedphrase!')

    return result.vault
  } catch (err: any) {
    importSpinner.fail('Secure vault import failed')
    if (err.message?.includes('not implemented')) {
      warn('\nSecure vault seedphrase import is not yet implemented in the SDK')
    }
    throw err
  }
}
