import * as fs from 'fs'
import * as path from 'path'
import { getKeyshareDir, findVultFiles } from '../utils/paths'
import { VaultLoader } from '../vault/VaultLoader'

export class ListCommand {
  readonly description = 'List available keyshare files'
  
  async run(): Promise<void> {
    const keyshareDir = getKeyshareDir()
    
    // Check if keyshare directory exists
    try {
      await fs.promises.access(keyshareDir)
    } catch {
      console.log('Keyshare directory not found. Run "vultisig init" first.')
      return
    }
    
    // Find .vult files
    const vultFiles = await findVultFiles(keyshareDir)
    
    if (vultFiles.length === 0) {
      console.log(`No keyshare files (.vult) found in: ${keyshareDir}`)
      console.log('\nPlace your .vult files in this directory to use them with the CLI.')
      return
    }
    
    console.log(`📁 Found ${vultFiles.length} keyshare file(s) in ${keyshareDir}:`)
    
    const vaultLoader = new VaultLoader()
    
    for (const file of vultFiles) {
      let encStatus = '🔐 encrypted'
      
      try {
        const isUnencrypted = await vaultLoader.checkIfUnencrypted(file)
        if (isUnencrypted) {
          encStatus = '🔓 unencrypted'
        }
      } catch {
        encStatus = '❓ unknown'
      }
      
      console.log(`  📄 ${path.basename(file)} (${encStatus})`)
    }
  }
}