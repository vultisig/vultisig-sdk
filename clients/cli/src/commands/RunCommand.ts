import * as fs from 'fs'
import * as path from 'path'
// SDK will be made available globally by the launcher
declare const VultisigSDK: any

// Polyfill File for Node.js
if (typeof File === 'undefined') {
  global.File = class File {
    public buffer: Buffer
    public _buffer: Buffer

    constructor(
      public chunks: any[],
      public name: string,
      public options?: any
    ) {
      // Create the buffer and set it directly as properties
      const buffer = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)))
      this.buffer = buffer
      this._buffer = buffer
    }

    arrayBuffer() {
      // Convert Buffer to ArrayBuffer
      const buffer = this.buffer || this._buffer
      return Promise.resolve(
        buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        )
      )
    }
  } as any
}
import { DaemonManager } from '../daemon/DaemonManager'
import { promptForPasswordWithValidation } from '../utils/password'
import { findVultFiles, getVaultsDir } from '../utils/paths'

export type RunOptions = {
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
      defaultChains: ['bitcoin', 'ethereum', 'solana'],
      defaultCurrency: 'USD',
    })

    // SDK will auto-initialize when we call methods on it
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
      const isEncrypted =
        fileName.toLowerCase().includes('password') &&
        !fileName.toLowerCase().includes('nopassword')

      let password = options.password
      if (isEncrypted && !password) {
        password = await promptForPasswordWithValidation(options.vault)
      } else if (!isEncrypted) {
        console.log('🔓 Vault is unencrypted, no password needed.')
      }

      // Set buffer property like in the tests
      ;(file as any).buffer = buffer

      // Use the new SDK API
      const vault = await sdk.addVault(file, password)
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
      const isEncrypted =
        fileName.toLowerCase().includes('password') &&
        !fileName.toLowerCase().includes('nopassword')

      let password = options.password
      if (isEncrypted && !password) {
        password = await promptForPasswordWithValidation(vaultPath)
      } else if (!isEncrypted) {
        console.log('🔓 Vault is unencrypted, no password needed.')
      }

      // Set buffer property like in the tests
      ;(file as any).buffer = buffer

      // Use the new SDK API
      const vault = await sdk.addVault(file, password)
      vaultStorage = vault
    }

    const summary = vaultStorage.summary()
    console.log('✅ Vault loaded successfully!')
    console.log(`📍 Vault: ${summary.name}`)
    console.log(`🆔 Vault ID: ${summary.id}`)
    console.log(
      `👥 Signers: ${summary.totalSigners} (threshold: ${summary.threshold})`
    )
    console.log(`🏷️  Type: ${summary.type}`)
    console.log(`💰 Currency: ${summary.currency}`)

    // Set as active vault
    // Vault is automatically set as active by sdk.addVault()

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
