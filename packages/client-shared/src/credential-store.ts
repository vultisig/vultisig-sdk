// Credential store — OS keyring via @napi-rs/keyring with encrypted-file fallback
// Keyring: macOS Keychain, Windows Credential Vault, Linux Secret Service (libsecret)
// Fallback: AES-256-GCM encrypted file at ~/.vultisig/credentials.enc for Docker/CI/headless

import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scryptCb)
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SERVICE_NAME = 'vultisig'

function getCredentialsPath(): string {
  return join(process.env.VULTISIG_CONFIG_DIR || join(homedir(), '.vultisig'), 'credentials.enc')
}

// --- Keyring backend (lazy import to avoid crash when native module unavailable) ---

// Three states: undefined = not yet checked, false = unavailable, module ref = available
let _keyringModule: typeof import('@napi-rs/keyring') | false | undefined

export function _resetAll(): void {
  _keyringModule = undefined
  useFileFallback = false
  filePassphrase = undefined
}

async function getKeyringModule(): Promise<typeof import('@napi-rs/keyring') | null> {
  if (_keyringModule === false) return null
  if (_keyringModule) return _keyringModule
  try {
    _keyringModule = await import('@napi-rs/keyring')
    return _keyringModule!
  } catch {
    _keyringModule = false
    return null
  }
}

async function keyringGet(account: string): Promise<string | null> {
  const mod = await getKeyringModule()
  if (!mod) return null
  try {
    return new mod.Entry(SERVICE_NAME, account).getPassword()
  } catch {
    return null
  }
}

async function keyringSet(account: string, password: string): Promise<void> {
  const mod = await getKeyringModule()
  if (!mod) throw new Error('Keyring not available')
  new mod.Entry(SERVICE_NAME, account).setPassword(password)
}

async function keyringDelete(account: string): Promise<void> {
  const mod = await getKeyringModule()
  if (!mod) return
  try {
    new mod.Entry(SERVICE_NAME, account).deletePassword()
  } catch {
    // ignore if not found
  }
}

// --- Encrypted file backend ---

async function getFileStore(passphrase: string): Promise<Map<string, string>> {
  const path = getCredentialsPath()
  let raw: Buffer
  try {
    raw = await readFile(path)
  } catch {
    return new Map()
  }
  const salt = raw.subarray(0, 16)
  const iv = raw.subarray(16, 28)
  const tag = raw.subarray(28, 44)
  const encrypted = raw.subarray(44)
  const key = (await scryptAsync(passphrase, salt, 32)) as Buffer
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return new Map(Object.entries(JSON.parse(decrypted.toString('utf-8'))))
}

async function saveFileStore(store: Map<string, string>, passphrase: string): Promise<void> {
  const dir = process.env.VULTISIG_CONFIG_DIR || join(homedir(), '.vultisig')
  await mkdir(dir, { recursive: true })
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = (await scryptAsync(passphrase, salt, 32)) as Buffer
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = JSON.stringify(Object.fromEntries(store))
  const encrypted = Buffer.concat([cipher.update(data, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  await writeFile(getCredentialsPath(), Buffer.concat([salt, iv, tag, encrypted]), { mode: 0o600 })
}

// --- Unified interface ---

let useFileFallback = false
let filePassphrase: string | undefined = process.env.VULTISIG_CREDENTIALS_PASSPHRASE

if (filePassphrase) useFileFallback = true

export function setFilePassphrase(passphrase: string): void {
  filePassphrase = passphrase
  useFileFallback = true
}

export function isUsingFileFallback(): boolean {
  return useFileFallback
}

async function get(account: string): Promise<string | null> {
  if (!useFileFallback) {
    try {
      const result = await keyringGet(account)
      if (result !== null) return result
    } catch {
      // keyring unavailable
    }
  }
  if (filePassphrase) {
    try {
      return (await getFileStore(filePassphrase)).get(account) ?? null
    } catch {
      return null
    }
  }
  return null
}

async function writeToFileStore(account: string, password: string): Promise<void> {
  const store = await getFileStore(filePassphrase!)
  store.set(account, password)
  await saveFileStore(store, filePassphrase!)
}

async function set(account: string, password: string): Promise<void> {
  if (useFileFallback && filePassphrase) {
    await writeToFileStore(account, password)
    return
  }
  try {
    await keyringSet(account, password)
  } catch {
    if (filePassphrase) {
      await writeToFileStore(account, password)
    } else {
      throw new Error('Cannot store credentials: keyring unavailable and no file passphrase configured')
    }
  }
}

async function del(account: string): Promise<void> {
  try {
    await keyringDelete(account)
  } catch {
    /* ignore */
  }
  if (filePassphrase) {
    const store = await getFileStore(filePassphrase)
    store.delete(account)
    await saveFileStore(store, filePassphrase)
  }
}

// --- Public API (unchanged signatures) ---

export async function getServerPassword(vaultId: string): Promise<string | null> {
  const fromStore = await get(`${vaultId}/server`)
  if (fromStore) return fromStore
  return process.env.VAULT_PASSWORD || null
}

export async function getStoredServerPassword(vaultId: string): Promise<string | null> {
  return get(`${vaultId}/server`)
}

export async function getDecryptionPassword(vaultId: string): Promise<string | null> {
  const fromStore = await get(`${vaultId}/decrypt`)
  if (fromStore) return fromStore
  return process.env.VAULT_DECRYPT_PASSWORD || null
}

export async function setServerPassword(vaultId: string, password: string): Promise<void> {
  await set(`${vaultId}/server`, password)
}

export async function setDecryptionPassword(vaultId: string, password: string): Promise<void> {
  await set(`${vaultId}/decrypt`, password)
}

export async function clearCredentials(vaultId: string): Promise<void> {
  await del(`${vaultId}/server`)
  await del(`${vaultId}/decrypt`)
}
