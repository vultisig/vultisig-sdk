// Auth vault registry — maps vault IDs to file paths for credential management.
// Chain/token persistence is handled by the SDK's vault.save() mechanism.

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// Resolve at call time (not module load) so VULTISIG_CONFIG_DIR is honored,
// matching credential-store — keeps the vault registry and credentials co-located.
function getConfigDir(): string {
  return process.env.VULTISIG_CONFIG_DIR || path.join(os.homedir(), '.vultisig')
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json')
}

export type VaultEntry = {
  id: string
  name: string
  filePath: string
}

export type VsigConfig = {
  vaults: VaultEntry[]
}

export async function loadConfig(): Promise<VsigConfig> {
  const filePath = getConfigFilePath()
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf-8')
  } catch (err) {
    // A missing file is the normal first-run case — stay silent. Any other
    // read failure (e.g. EACCES) is worth surfacing before falling back.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(
        `[vultisig] Could not read config at ${filePath}: ${(err as Error)?.message ?? String(err)}. Using an empty registry.`
      )
    }
    return { vaults: [] }
  }
  try {
    return JSON.parse(raw) as VsigConfig
  } catch (err) {
    // Corrupted config (e.g. partial write or single-byte corruption): warn
    // loudly instead of silently factory-resetting, which would vanish the
    // user's vault registry. The bad file is left intact AT LOAD TIME (the next
    // saveConfig still overwrites it when the user mutates state) — this is not
    // durable recovery, just a chance to inspect the file before the next write.
    console.warn(
      `[vultisig] Config at ${filePath} is corrupted (${(err as Error)?.message ?? String(err)}); using an empty registry. The file was left intact at load time.`
    )
    return { vaults: [] }
  }
}

export async function saveConfig(config: VsigConfig): Promise<void> {
  const dir = getConfigDir()
  const filePath = getConfigFilePath()
  // 0o700 dir / 0o600 file: the registry maps vault IDs to on-disk vault file
  // paths and lives alongside credentials. Mirror credential-store's hardening
  // (commit 7bafd71a).
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), { mode: 0o600 })
  // writeFile's `mode` is honored only when the file is CREATED; an existing
  // config.json keeps its old perms. chmod every write so a pre-existing (or
  // out-of-band) file can't retain looser, world-readable perms.
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    /* best-effort: non-POSIX FS (e.g. Windows) ignores perms */
  }
}

export function getConfigPath(): string {
  return getConfigFilePath()
}
