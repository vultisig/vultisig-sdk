import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

const SEARCH_DIRS = [
  path.join(os.homedir(), '.vultisig'),
  path.join(os.homedir(), 'Documents', 'Vultisig'),
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'Documents'),
]

export { SEARCH_DIRS }

export async function discoverVaultFiles(extraDirs: string[] = []): Promise<string[]> {
  const dirs = [...SEARCH_DIRS, process.cwd(), ...extraDirs]
  const found: string[] = []

  for (const dir of dirs) {
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
