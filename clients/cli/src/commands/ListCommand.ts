import * as fs from 'fs'
import * as path from 'path'
import { VaultManager } from '../vultisig-sdk-mocked'
import { getVaultsDir, findVultFiles } from '../utils/paths'

export class ListCommand {
  readonly description = 'List available vault files'
  
  async run(): Promise<void> {
    console.log('📁 Scanning for vault files...')
    
    // Check for .vult files in vaults directory
    const vaultsDir = getVaultsDir()
    
    try {
      await fs.promises.access(vaultsDir)
    } catch {
      console.log('Vaults directory not found. Run "vultisig init" first.')
      return
    }
    
    const vultFiles = await findVultFiles(vaultsDir)
    
    if (vultFiles.length === 0) {
      console.log(`No vault files (.vult) found in: ${vaultsDir}`)
      console.log('\nPlace your .vult files in this directory to use them with the CLI.')
      return
    }
    
    console.log(`📁 Found ${vultFiles.length} vault file(s) in ${vaultsDir}:`)
    
    // Check each file using SDK VaultManager
    const vaultManager = new VaultManager()
    
    for (const filePath of vultFiles) {
      try {
        const buffer = await fs.promises.readFile(filePath)
        const file = new File([buffer], path.basename(filePath))
        
        // Check if encrypted from filename hint
        const fileName = path.basename(filePath)
        const isEncrypted = fileName.toLowerCase().includes('password') && !fileName.toLowerCase().includes('nopassword')
        const status = isEncrypted ? '🔐 encrypted' : '🔓 unencrypted'
        
        console.log(`  📄 ${path.basename(filePath)} (${status})`)
        
      } catch (error) {
        console.log(`  📄 ${path.basename(filePath)} (❓ unknown - ${error instanceof Error ? error.message : 'error'})`)
      }
    }
    
    // Also check for already loaded vaults in SDK storage
    try {
      const storedVaults = await VaultManager.list()
      if (storedVaults.length > 0) {
        console.log(`\n💾 Found ${storedVaults.length} vault(s) in storage:`)
        for (const summary of storedVaults) {
          const status = summary.isEncrypted ? '🔐 encrypted' : '🔓 unencrypted'
          const type = summary.type || 'unknown'
          console.log(`  🏛️  ${summary.name} (${status}, ${type})`)
        }
      }
    } catch (error) {
      // Storage not initialized yet, that's OK
    }
  }
}