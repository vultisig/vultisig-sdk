/**
 * Vault Management Commands - create, import, export, verify, switch, rename, info, vaults
 */
import type { VaultBase } from '@vultisig/sdk'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'
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
          await ctx.sdk.resendVaultVerification(vaultId)
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
  options: { resend?: boolean; code?: string } = {}
): Promise<boolean> {
  if (options.resend) {
    const spinner = createSpinner('Resending verification email...')
    await ctx.sdk.resendVaultVerification(vaultId)
    spinner.succeed('Verification email sent!')
    info('Check your inbox for the new verification code.')
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
  encrypt?: boolean
  password?: string
}

/**
 * Execute export vault command
 */
export async function executeExport(ctx: CommandContext, options: ExportVaultOptions = {}): Promise<string> {
  const vault = await ctx.ensureActiveVault()

  let encrypt = options.encrypt
  let password = options.password

  // Only prompt if --encrypt/--no-encrypt not specified
  if (encrypt === undefined) {
    const encryptAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'encrypt',
        message: 'Encrypt export with password?',
        default: true,
      },
    ])
    encrypt = encryptAnswer.encrypt
  }

  if (encrypt && !password) {
    const passwordAnswer = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter password:',
        mask: '*',
      },
    ])
    password = passwordAnswer.password
  }

  const spinner = createSpinner('Exporting vault...')

  // Pass password to export if encrypting
  const { data: vultContent } = await vault.export(encrypt ? password : undefined)
  const fileName = options.outputPath || `${vault.name}-${vault.localPartyId}-vault.vult`

  await fs.writeFile(fileName, vultContent, 'utf-8')

  spinner.succeed(`Vault exported: ${fileName}`)

  success('\n+ Vault exported successfully!')
  info(`File: ${fileName}`)

  return fileName
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
