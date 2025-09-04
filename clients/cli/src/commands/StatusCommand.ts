import { VaultManager } from '../vultisig-sdk-mocked'
import { DaemonManager } from '../daemon/DaemonManager'

export class StatusCommand {
  readonly description = 'Check daemon status and connectivity'
  
  async run(): Promise<void> {
    console.log('🔍 Checking daemon status...')
    
    const daemonManager = new DaemonManager()
    
    try {
      await daemonManager.checkDaemonStatus()
      
      // If daemon is running, get additional info
      const activeVault = VaultManager.getActive()
      if (activeVault) {
        const summary = activeVault.summary()
        console.log(`📍 Active vault: ${summary.name}`)
        console.log(`🔧 Type: ${summary.type}`)
        console.log(`👥 Signers: ${summary.totalSigners}`)
      }
      
    } catch (error) {
      console.error('❌', error instanceof Error ? error.message : error)
      
      // Check if there are any stored vaults
      try {
        const vaults = await VaultManager.list()
        if (vaults.length > 0) {
          console.log(`\n💾 Found ${vaults.length} stored vault(s) available to load`)
        }
      } catch {
        // Storage not initialized
      }
      
      process.exit(1)
    }
  }
}