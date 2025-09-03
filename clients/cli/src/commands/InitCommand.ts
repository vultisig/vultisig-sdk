import * as fs from 'fs'
import * as path from 'path'
import { getConfigDir, getVaultDir, getKeyshareDir, ensureDirectoryExists } from '../utils/paths'

export class InitCommand {
  readonly description = 'Initialize directories and configuration'
  
  async run(): Promise<void> {
    const configDir = getConfigDir()
    const vaultDir = getVaultDir()
    const keyshareDir = getKeyshareDir()
    
    // Create directories
    const dirs = [configDir, vaultDir, keyshareDir]
    for (const dir of dirs) {
      await ensureDirectoryExists(dir)
      console.log(`✅ Created: ${dir}`)
    }
    
    // Create basic config file
    const configFile = path.join(configDir, 'vultisig-config.yaml')
    try {
      await fs.promises.access(configFile)
      // File exists, don't overwrite
    } catch {
      const config = `# Vultisig CLI Configuration (vultisig-config.yaml)

websocket_port: 8787          # WebSocket server port (auto-adjusts if busy)
http_port: 18080              # HTTP relay port (fixed per protocol spec)
enable_mobile_signing: true   # Enable mobile app discovery/signing
use_vultisig_relay: false     # Use external Vultisig relay servers
enable_local_relay: true      # Enable local relay server
`
      
      await fs.promises.writeFile(configFile, config, { mode: 0o600 })
      console.log(`✅ Created: ${configFile}`)
    }
    
    console.log('\
🎉 Vultisig CLI initialized successfully!')
    console.log(`📂 Config directory: ${configDir}`)
    console.log(`🗃️  Vault directory: ${vaultDir}`)
    console.log(`🔑 Keyshare directory: ${keyshareDir}`)
    console.log('\
📋 Next steps:')
    console.log(`1. Copy your .vult keyshare files to ${keyshareDir}`)
    console.log('2. Start the daemon with: vultisig run')
    console.log('3. View addresses with: vultisig address')
  }
}