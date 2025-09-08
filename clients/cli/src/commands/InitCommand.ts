import {
  ensureDirectoryExists,
  getConfigDir,
  getVaultsDir,
} from '../utils/paths'

export class InitCommand {
  readonly description = 'Initialize directories and configuration files'

  async run(): Promise<void> {
    console.log('🚀 Initializing Vultisig CLI...')

    // Create configuration directory
    const configDir = getConfigDir()
    await ensureDirectoryExists(configDir)
    console.log(`✅ Created config directory: ${configDir}`)

    // Create vaults directory
    const vaultsDir = getVaultsDir()
    await ensureDirectoryExists(vaultsDir)
    console.log(`✅ Created vaults directory: ${vaultsDir}`)

    console.log('\n🎉 Initialization complete!')
    console.log('\nNext steps:')
    console.log('1. Place your .vult vault files in:', vaultsDir)
    console.log('2. List available vaults: vultisig list')
    console.log('3. Start the daemon: vultisig run')
  }
}
