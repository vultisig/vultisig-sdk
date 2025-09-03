import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'

export function getConfigDir(): string {
  return path.join(os.homedir(), '.vultisig')
}

export function getVaultDir(): string {
  return path.join(getConfigDir(), 'vaults')
}

export function getKeyshareDir(): string {
  // Use keyshares directory relative to current working directory
  // This matches the intended usage: user has binary and keyshares folder together
  return path.join(process.cwd(), 'keyshares')
}

export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.promises.mkdir(dirPath, { recursive: true, mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error
    }
  }
}

export async function findVultFiles(dir: string): Promise<string[]> {
  const vultFiles: string[] = []
  
  try {
    const walk = async (currentDir: string) => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name)
        
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.vult')) {
          vultFiles.push(fullPath)
        }
      }
    }
    
    await walk(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
  
  return vultFiles
}