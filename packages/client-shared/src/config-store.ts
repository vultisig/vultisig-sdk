// Auth vault registry — maps vault IDs to file paths for credential management.
// Chain/token persistence is handled by the SDK's vault.save() mechanism.

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const CONFIG_DIR = path.join(os.homedir(), '.vultisig')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export type VaultEntry = {
  id: string
  name: string
  filePath: string
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
