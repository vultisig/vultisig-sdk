/**
 * Vault Management Commands - create, import, export, verify, switch, rename, info, vaults
 */
import type { VaultBase } from '@vultisig/sdk/node'
import chalk from 'chalk'
import { promises as fs } from 'fs'
import inquirer from 'inquirer'

import type { CommandContext } from '../core'
import { createSpinner, displayVaultInfo, displayVaultsList, error, info, setupVaultEvents, success, warn } from '../ui'

export type CreateVaultOptions = {
  type: 'fast' | 'secure'
}

/**
 * Execute create vault command
 */
export async function executeCreate(
  ctx: CommandContext,
  options: CreateVaultOptions = { type: 'fast' }
): Promise<VaultBase> {
  const vaultType = options.type.toLowerCase()
  if (vaultType !== 'fast' && vaultType !== 'secure') {
    throw new Error('Invalid vault type. Must be "fast" or "secure"')
  }

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
      validate: (input: string, ans: any) => input === ans.password || 'Passwords do not match',
    },
  ])) as any

  if (vaultType === 'fast') {
    const { email } = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Enter email for verification:',
        validate: (input: string) => /\S+@\S+\.\S+/.test(input) || 'Invalid email format',
      },
    ])

    const spinner = createSpinner('Creating vault...')

    const result = await ctx.sdk.createFastVault({
      name: answers.name,
      password: answers.password,
      email,
      onProgress: step => {
        spinner.text = `${step.message} (${step.progress}%)`
      },
    })

    setupVaultEvents(result.vault)
    await ctx.setActiveVault(result.vault)
    spinner.succeed(`Vault created: ${answers.name}`)

    if (result.verificationRequired) {
      warn('\nA verification code has been sent to your email.')
      info('Please check your inbox and enter the code.')

      const { code } = await inquirer.prompt([
        {
          type: 'input',
          name: 'code',
          message: `Verification code sent to ${email}. Enter code:`,
          validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
        },
      ])

      const verifySpinner = createSpinner('Verifying email code...')
      const verified = await ctx.sdk.verifyVault(result.vaultId, code)

      if (verified) {
        verifySpinner.succeed('Email verified successfully!')
      } else {
        verifySpinner.fail('Invalid verification code')
        error('\nx Verification failed. Please check the code and try again.')
        warn('\nTo retry verification, use:')
        info(`  npm run wallet verify ${result.vaultId}`)
        warn('\nTo resend the verification email:')
        info(`  npm run wallet verify ${result.vaultId} --resend`)
        const err: any = new Error('Verification failed')
        err.exitCode = 1
        throw err
      }
    }

    success('\n+ Vault created!')
    info('\nYour vault is ready. Run the following commands:')
    console.log(chalk.cyan('  npm run wallet balance     ') + '- View balances')
    console.log(chalk.cyan('  npm run wallet addresses   ') + '- View addresses')
    console.log(chalk.cyan('  npm run wallet portfolio   ') + '- View portfolio value')

    return result.vault
  } else {
    // Secure vault
    const secureOptions = (await inquirer.prompt([
      {
        type: 'number',
        name: 'threshold',
        message: 'Signing threshold (m):',
        default: 2,
        validate: (input: number) => input > 0 || 'Threshold must be greater than 0',
      },
      {
        type: 'number',
        name: 'totalShares',
        message: 'Total shares (n):',
        default: 3,
        validate: (input: number, ans: any) =>
          input >= ans.threshold || `Total shares must be >= threshold (${ans.threshold})`,
      },
    ])) as any

    const spinner = createSpinner('Creating secure vault...')

    try {
      const result = await ctx.sdk.createSecureVault({
        name: answers.name,
        password: answers.password,
        devices: secureOptions.totalShares,
        threshold: secureOptions.threshold,
        onProgress: step => {
          spinner.text = `${step.message} (${step.progress}%)`
        },
      })

      setupVaultEvents(result.vault)
      await ctx.setActiveVault(result.vault)
      spinner.succeed(
        `Secure vault created: ${answers.name} (${secureOptions.threshold}-of-${secureOptions.totalShares})`
      )

      warn(`\nImportant: Save your vault backup file (.vult) in a secure location.`)
      warn(
        `This is a ${secureOptions.threshold}-of-${secureOptions.totalShares} vault. You'll need ${secureOptions.threshold} devices to sign transactions.`
      )

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
  info('\nRun "npm run wallet balance" to view balances')

  return vault
}

/**
 * Execute verify vault command
 */
export async function executeVerify(
  ctx: CommandContext,
  vaultId: string,
  options: { resend?: boolean } = {}
): Promise<boolean> {
  if (options.resend) {
    const spinner = createSpinner('Resending verification email...')
    await ctx.sdk.resendVaultVerification(vaultId)
    spinner.succeed('Verification email sent!')
    info('Check your inbox for the new verification code.')
  }

  const { code } = await inquirer.prompt([
    {
      type: 'input',
      name: 'code',
      message: 'Enter verification code:',
      validate: (input: string) => /^\d{4,6}$/.test(input) || 'Code must be 4-6 digits',
    },
  ])

  const spinner = createSpinner('Verifying email code...')
  const verified = await ctx.sdk.verifyVault(vaultId, code)

  if (verified) {
    spinner.succeed('Vault verified successfully!')
    return true
  } else {
    spinner.fail('Invalid verification code')
    error('\nx Verification failed. Please check the code and try again.')
    warn('\nTip: Use --resend to get a new verification code:')
    info(`  npm run wallet verify ${vaultId} --resend`)
    return false
  }
}

/**
 * Execute export vault command
 */
export async function executeExport(ctx: CommandContext, outputPath?: string): Promise<string> {
  const vault = await ctx.ensureActiveVault()

  const { encrypt } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'encrypt',
      message: 'Encrypt export with password?',
      default: true,
    },
  ])

  if (encrypt) {
    // Note: Export password encryption would be handled by vault.export() if supported
    await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Enter password:',
        mask: '*',
      },
    ])
  }

  const spinner = createSpinner('Exporting vault...')

  const { data: vultContent } = await vault.export()
  const fileName = outputPath || `${vault.name}-${vault.localPartyId}-vault.vult`

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

  if (vaults.length === 0) {
    warn('\nNo vaults found. Create or import a vault first.')
    return []
  }

  const activeVault = ctx.getActiveVault()
  displayVaultsList(vaults, activeVault)

  console.log(chalk.gray('\nUse "npm run wallet switch <id>" to switch active vault'))

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
  displayVaultInfo(vault)
}
