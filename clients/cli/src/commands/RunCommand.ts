import * as path from 'path'
import { WASMManager } from 'vultisig-sdk'
import { getKeyshareDir, findVultFiles } from '../utils/paths'
import { VaultLoader } from '../vault/VaultLoader'
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
    
    // Initialize WASM libraries first
    console.log('⚙️ Initializing WASM libraries...')
    const wasmManager = new WASMManager()
    await wasmManager.initialize()
    console.log('✅ WASM libraries initialized successfully')
    
    // Auto-discovery if no vault specified
    let vaultPath = options.vault
    if (!vaultPath) {
      const keyshareDir = getKeyshareDir()
      const vultFiles = await findVultFiles(keyshareDir)
      
      if (vultFiles.length === 0) {
        throw new Error(`No keyshare files (.vult) found in ${keyshareDir}`)
      }
      
      vaultPath = vultFiles[0]
      console.log(`📄 Auto-discovered keyshare: ${path.basename(vaultPath)}`)
    }
    
    const vaultLoader = new VaultLoader()
    
    // Check if vault is encrypted
    const isUnencrypted = await vaultLoader.checkIfUnencrypted(vaultPath)
    
    // Handle password for encrypted vaults
    let password = options.password
    if (!password && !isUnencrypted) {
      password = await promptForPasswordWithValidation(vaultPath)
    } else if (isUnencrypted) {
      console.log('🔓 Vault is unencrypted, no password needed.')
    }
    
    // Load and decrypt the vault
    console.log(`📂 Loading vault: ${vaultPath}`)
    const vault = await vaultLoader.loadVaultFromFile(vaultPath, password)
    
    console.log('✅ Vault loaded successfully!')
    console.log(`📍 Vault: ${vault.name}`)
    console.log(`🆔 Local Party ID: ${vault.localPartyId}`)
    console.log(`👥 Signers: ${vault.signers.join(', ')}`)
    console.log(`🔧 Library Type: ${vault.libType === 1 ? 'DKLS' : 'GG20'}`)
    
    if (options.config) {
      console.log(`📋 Config: ${options.config}`)
    }
    
    console.log('\n🔄 Starting daemon services...')
    console.log('💡 You can now run "vultisig address" in another terminal')
    console.log('⏹️  Press Ctrl+C to stop\n')
    
    // Start daemon
    const daemonManager = new DaemonManager()
    await daemonManager.startDaemon(vaultPath, password, vault)
  }
}