import * as fs from 'fs'
import * as path from 'path'
import { VaultManager, VultisigSDK } from '../vultisig-sdk-mocked'
import { getVaultsDir, findVultFiles } from '../utils/paths'
import { promptForPasswordWithValidation } from '../utils/password'
import { DaemonManager } from '../daemon/DaemonManager'

export interface RunOptions {
  vault?: string
  password?: string
  config?: string
}

export class RunCommand {
  readonly description = 'Start the MPC signing daemon'
  
  async run(options: RunOptions): Promise<void> {
    console.log('🚀 Starting Vultisig daemon...')
    
    // Initialize SDK first
    console.log('⚙️ Initializing Vultisig SDK...')
    const sdk = new VultisigSDK({
      vaultManagerConfig: {
        defaultChains: ['bitcoin', 'ethereum', 'solana'],
        defaultCurrency: 'USD'
      }
    })
    
    await sdk.initialize()
    console.log('✅ SDK initialized successfully')
    
    // Auto-discovery or load specific vault file
    let vaultStorage
    
    if (options.vault) {
      // Load specific vault file
      console.log(`📂 Loading vault: ${options.vault}`)
      const buffer = await fs.promises.readFile(options.vault)
      const file = new File([buffer], path.basename(options.vault))
      
      // Check if encrypted from filename hint (for .vult files)
      const fileName = path.basename(options.vault)
      const isEncrypted = fileName.toLowerCase().includes('password') && !fileName.toLowerCase().includes('nopassword')
      
      let password = options.password
      if (isEncrypted && !password) {
        password = await promptForPasswordWithValidation(options.vault)
      } else if (!isEncrypted) {
        console.log('🔓 Vault is unencrypted, no password needed.')
      }
      
      const vault = await VaultManager.add(file, password)
      await VaultManager.load(vault, password)
      vaultStorage = vault
      
    } else {
      // Auto-discovery
      const vaultsDir = getVaultsDir()
      const vultFiles = await findVultFiles(vaultsDir)
      
      if (vultFiles.length === 0) {
        throw new Error(`No vault files (.vult) found in ${vaultsDir}`)
      }
      
      const vaultPath = vultFiles[0]
      console.log(`📄 Auto-discovered vault: ${path.basename(vaultPath)}`)
      
      const buffer = await fs.promises.readFile(vaultPath)
      const file = new File([buffer], path.basename(vaultPath))
      
      const fileName = path.basename(vaultPath)
      const isEncrypted = fileName.toLowerCase().includes('password') && !fileName.toLowerCase().includes('nopassword')
      
      let password = options.password
      if (isEncrypted && !password) {
        password = await promptForPasswordWithValidation(vaultPath)
      } else if (!isEncrypted) {
        console.log('🔓 Vault is unencrypted, no password needed.')
      }
      
      const vault = await VaultManager.add(file, password)
      await VaultManager.load(vault, password)
      vaultStorage = vault
    }
    
    const summary = vaultStorage.summary()
    console.log('✅ Vault loaded successfully!')
    console.log(`📍 Vault: ${summary.name}`)
    console.log(`🆔 Vault ID: ${summary.id}`)
    console.log(`👥 Signers: ${summary.totalSigners} (threshold: ${summary.threshold})`)
    console.log(`🏷️  Type: ${summary.type}`)
    console.log(`💰 Currency: ${summary.currency}`)
    
    // Set as active vault
    VaultManager.setActive(vaultStorage)
    
    if (options.config) {
      console.log(`📋 Config: ${options.config}`)
    }
    
    console.log('\n🔄 Starting daemon services...')
    console.log('💡 You can now run "vultisig address" in another terminal')
    console.log('⏹️  Press Ctrl+C to stop\n')
    
    // Start daemon with the loaded vault storage
    const daemonManager = new DaemonManager()
    await daemonManager.startDaemon(vaultStorage)
  }
}