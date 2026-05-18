// Interactive auth setup — shared between CLI and MCP.
// Imports vault, prompts for passwords, stores credentials in keyring.

import * as fs from 'node:fs/promises'
import { dirname } from 'node:path'

import { Vultisig } from '@vultisig/sdk'
import inquirer from 'inquirer'

import { loadConfig, saveConfig } from './config-store.js'
import {
  clearCredentials,
  getStoredServerPassword,
  isUsingFileFallback,
  setDecryptionPassword,
  setFilePassphrase,
  setServerPassword,
} from './credential-store.js'
import { discoverVaultFiles, SEARCH_DIRS } from './vault-discovery.js'

type AuthSetupOpts = {
  vaultFile?: string
  nonInteractive?: boolean
}

type ImportedVault = Awaited<ReturnType<Vultisig['importVault']>>

async function resolveVaultFilePath(opts: AuthSetupOpts): Promise<string> {
  if (opts.vaultFile) return opts.vaultFile

  const config = await loadConfig()
  const extraDirs = config.vaults
    .map(v => v.filePath)
    .filter(Boolean)
    .map(f => dirname(f))
  const files = await discoverVaultFiles(extraDirs)

  if (files.length === 0) {
    const searched = [...SEARCH_DIRS, process.cwd()].join('\n  - ')
    throw new Error(
      `No .vult files found. Searched:\n  - ${searched}\n\n` +
        'Export your vault from the Vultisig app and place the .vult file in one of these locations,\n' +
        'or specify the path directly: vsig auth setup --vault-file /path/to/vault.vult'
    )
  }

  if (files.length === 1) return files[0]
  if (!process.stdin.isTTY || opts.nonInteractive) {
    throw new Error(
      'Multiple vault files found but no TTY available. Use --vault-file <path> to specify which vault to use.'
    )
  }

  const { selected } = await inquirer.prompt([
    { type: 'list', name: 'selected', message: 'Select a vault file:', choices: files },
  ])
  if (!selected) throw new Error('No vault file selected')
  return selected
}

async function importEncryptedVaultFromEnv(
  sdk: Vultisig,
  vaultContent: string
): Promise<{
  vault: ImportedVault
  decryptPassword: string
}> {
  const envDecryptPw = process.env.VAULT_DECRYPT_PASSWORD
  if (!envDecryptPw) throw new Error('unreachable: missing VAULT_DECRYPT_PASSWORD')

  try {
    return {
      vault: await sdk.importVault(vaultContent, envDecryptPw),
      decryptPassword: envDecryptPw,
    }
  } catch {
    throw new Error(
      'VAULT_DECRYPT_PASSWORD is set but failed to decrypt the vault. Check that the password is correct.'
    )
  }
}

async function importEncryptedVaultInteractively(
  sdk: Vultisig,
  vaultContent: string
): Promise<{ vault: ImportedVault; decryptPassword: string }> {
  const MAX_ATTEMPTS = 3

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { password } = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message:
          attempt === 1
            ? 'Enter vault file password (the password you chose when exporting/backing up from the Vultisig app):'
            : `Wrong password. Try again (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        mask: '*',
      },
    ])
    try {
      return { vault: await sdk.importVault(vaultContent, password), decryptPassword: password }
    } catch {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error('Failed to decrypt vault after 3 attempts. Check your decryption password.')
      }
    }
  }

  throw new Error('unreachable: encrypted vault import attempts exhausted')
}

async function importVaultForSetup(
  sdk: Vultisig,
  vaultContent: string,
  opts: AuthSetupOpts
): Promise<{ vault: ImportedVault; decryptPassword?: string; isEncrypted: boolean }> {
  const isEncrypted = sdk.isVaultEncrypted(vaultContent)
  if (!isEncrypted) return { vault: await sdk.importVault(vaultContent, undefined), isEncrypted }

  if (process.env.VAULT_DECRYPT_PASSWORD) {
    return { ...(await importEncryptedVaultFromEnv(sdk, vaultContent)), isEncrypted }
  }
  if (!process.stdin.isTTY || opts.nonInteractive) {
    throw new Error(
      'Vault is encrypted but no TTY available. Set VAULT_DECRYPT_PASSWORD env var for non-interactive usage.'
    )
  }

  return { ...(await importEncryptedVaultInteractively(sdk, vaultContent)), isEncrypted }
}

async function promptServerPassword(opts: AuthSetupOpts): Promise<string> {
  const envServerPw = process.env.VAULT_PASSWORD
  if (envServerPw) return envServerPw
  if (!process.stdin.isTTY || opts.nonInteractive) {
    throw new Error('No TTY available for password prompt. Set VAULT_PASSWORD env var for non-interactive usage.')
  }

  const response = await inquirer.prompt([
    {
      type: 'password',
      name: 'serverPassword',
      message: 'Enter VultiServer password (your server signing password, used for 2-of-2 MPC signing):',
      mask: '*',
    },
  ])
  return response.serverPassword
}

async function resolveFilePassphrase(opts: AuthSetupOpts): Promise<string> {
  const envPassphrase = process.env.VULTISIG_CREDENTIALS_PASSPHRASE
  if (envPassphrase) return envPassphrase
  if (!process.stdin.isTTY || opts.nonInteractive) {
    throw new Error(
      'OS keyring unavailable and no TTY for passphrase prompt. Set VULTISIG_CREDENTIALS_PASSPHRASE env var.'
    )
  }

  const response = await inquirer.prompt([
    {
      type: 'password',
      name: 'passphrase',
      message:
        'OS keyring unavailable. Enter a passphrase to encrypt credentials on disk (~/.vultisig/credentials.enc):',
      mask: '*',
    },
  ])
  return response.passphrase
}

async function writeVaultCredentials(
  vaultId: string,
  serverPassword: string,
  isEncrypted: boolean,
  decryptPassword?: string
): Promise<void> {
  await setServerPassword(vaultId, serverPassword)
  if (isEncrypted && decryptPassword) await setDecryptionPassword(vaultId, decryptPassword)
}

async function persistVaultCredentials(
  vaultId: string,
  serverPassword: string,
  isEncrypted: boolean,
  decryptPassword: string | undefined,
  opts: AuthSetupOpts
): Promise<void> {
  try {
    await writeVaultCredentials(vaultId, serverPassword, isEncrypted, decryptPassword)
  } catch {
    setFilePassphrase(await resolveFilePassphrase(opts))
    await writeVaultCredentials(vaultId, serverPassword, isEncrypted, decryptPassword)
  }
}

async function saveVaultEntry(vault: ImportedVault, vaultFilePath: string): Promise<void> {
  const config = await loadConfig()
  const existing = config.vaults.findIndex(c => c.id === vault.id)
  const entry = { id: vault.id, name: vault.name, filePath: vaultFilePath }
  if (existing >= 0) {
    config.vaults[existing] = entry
  } else {
    config.vaults.push(entry)
  }
  await saveConfig(config)
}

export async function executeAuthSetup(
  opts: AuthSetupOpts
): Promise<{ vaultId: string; vaultName: string; storageBackend: 'keyring' | 'file' }> {
  const vaultFilePath = await resolveVaultFilePath(opts)
  const vaultContent = await fs.readFile(vaultFilePath, 'utf-8')

  const sdk = new Vultisig({})
  try {
    const { vault, decryptPassword, isEncrypted } = await importVaultForSetup(sdk, vaultContent, opts)
    const serverPassword = await promptServerPassword(opts)

    await persistVaultCredentials(vault.id, serverPassword, isEncrypted, decryptPassword, opts)
    await saveVaultEntry(vault, vaultFilePath)

    return { vaultId: vault.id, vaultName: vault.name, storageBackend: isUsingFileFallback() ? 'file' : 'keyring' }
  } finally {
    if (typeof sdk.dispose === 'function') sdk.dispose()
  }
}

export async function executeAuthStatus(): Promise<
  Array<{ id: string; name: string; filePath: string; hasCredentials: boolean }>
> {
  const config = await loadConfig()

  return Promise.all(
    config.vaults.map(async vault => {
      let hasCredentials = false
      try {
        const pw = await getStoredServerPassword(vault.id)
        hasCredentials = pw !== null
      } catch {
        // no credentials
      }
      return { id: vault.id, name: vault.name, filePath: vault.filePath, hasCredentials }
    })
  )
}

export async function executeAuthLogout(opts: { vaultId?: string; all?: boolean }): Promise<void> {
  const config = await loadConfig()

  if (opts.all) {
    for (const vault of config.vaults) {
      await clearCredentials(vault.id)
    }
    config.vaults = []
  } else if (opts.vaultId) {
    await clearCredentials(opts.vaultId)
    config.vaults = config.vaults.filter(v => v.id !== opts.vaultId)
  } else if (config.vaults.length === 1) {
    await clearCredentials(config.vaults[0].id)
    config.vaults = []
  } else if (config.vaults.length > 1) {
    throw new Error('Multiple vaults configured. Use --vault-id <id> or --all. Run: vsig auth status')
  } else {
    throw new Error('No vaults configured. Run: vsig auth setup')
  }

  await saveConfig(config)
}
