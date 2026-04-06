import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const CONFIG_DIR = path.join(os.homedir(), '.vultisig')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export type PersistedToken = {
  id: string
  symbol: string
  decimals: number
  contractAddress: string
}

export type VaultEntry = {
  id: string
  name: string
  filePath: string
  extraChains?: string[]
  tokens?: Record<string, PersistedToken[]>
}

export type VsigConfig = {
  vaults: VaultEntry[]
}

export async function loadConfig(): Promise<VsigConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as VsigConfig
  } catch {
    return { vaults: [] }
  }
}

export async function saveConfig(config: VsigConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export async function persistTokens(vaultId: string, chain: string, tokens: PersistedToken[]): Promise<void> {
  const config = await loadConfig()
  const entry = config.vaults.find(v => v.id === vaultId)
  if (!entry) return
  if (!entry.tokens) entry.tokens = {}
  entry.tokens[chain] = tokens
  await saveConfig(config)
}

export async function removePersistedToken(vaultId: string, chain: string, contractAddress: string): Promise<void> {
  const config = await loadConfig()
  const entry = config.vaults.find(v => v.id === vaultId)
  if (!entry?.tokens?.[chain]) return
  entry.tokens[chain] = entry.tokens[chain].filter(t => t.contractAddress !== contractAddress)
  if (entry.tokens[chain].length === 0) delete entry.tokens[chain]
  await saveConfig(config)
}

export async function clearPersistedTokens(vaultId: string, chain?: string): Promise<void> {
  const config = await loadConfig()
  const entry = config.vaults.find(v => v.id === vaultId)
  if (!entry?.tokens) return
  if (chain) {
    delete entry.tokens[chain]
  } else {
    entry.tokens = {}
  }
  await saveConfig(config)
}

export async function persistExtraChains(vaultId: string, chains: string[]): Promise<void> {
  const config = await loadConfig()
  const entry = config.vaults.find(v => v.id === vaultId)
  if (!entry) return
  entry.tokens = entry.tokens ?? {}
  entry.extraChains = chains
  await saveConfig(config)
}

export async function getVaultEntry(vaultId: string): Promise<VaultEntry | undefined> {
  const config = await loadConfig()
  return config.vaults.find(v => v.id === vaultId)
}

export async function ensureVaultEntry(vaultId: string, name: string, filePath: string): Promise<VaultEntry> {
  const config = await loadConfig()
  let entry = config.vaults.find(v => v.id === vaultId)
  if (!entry) {
    entry = { id: vaultId, name, filePath }
    config.vaults.push(entry)
    await saveConfig(config)
  }
  return entry
}
