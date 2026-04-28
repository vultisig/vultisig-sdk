import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

// Directories scanned with depth 2 (dedicated vultisig locations)
const DEEP_DIRS = [path.join(os.homedir(), '.vultisig'), path.join(os.homedir(), 'Documents', 'Vultisig')]

export const SEARCH_DIRS = [...DEEP_DIRS]

export async function discoverVaultFiles(extraDirs: string[] = []): Promise<string[]> {
  const found: string[] = []
  const allDirs = [...DEEP_DIRS, process.cwd(), ...extraDirs]
  process.stderr.write(`Scanning for .vult files in: ${allDirs.join(', ')}\n`)

  for (const dir of DEEP_DIRS) {
    await scanDir(dir, found, 0, 2)
  }
  await scanDir(process.cwd(), found, 0, 1)
  for (const dir of extraDirs) {
    await scanDir(dir, found, 0, 2)
  }

  return [...new Set(found)]
}

async function scanDir(dir: string, found: string[], depth: number, maxDepth: number): Promise<void> {
  if (depth > maxDepth) return
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.endsWith('.vult')) {
        found.push(fullPath)
      } else if (entry.isDirectory() && depth < maxDepth) {
        await scanDir(fullPath, found, depth + 1, maxDepth)
      }
    }
  } catch {
    // directory doesn't exist or not accessible
  }
}
