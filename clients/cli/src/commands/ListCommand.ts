import * as fs from 'fs'
import * as path from 'path'
// SDK will be made available globally by the launcher
declare const VultisigSDK: any

// Polyfill File for Node.js
if (typeof File === 'undefined') {
  global.File = class File {
    constructor(
      public chunks: any[],
      public name: string,
      public options?: any
    ) {}
    arrayBuffer() {
      return Promise.resolve(
        Buffer.concat(this.chunks.map(chunk => Buffer.from(chunk)))
      )
    }
  } as any
}
import { findVultFiles, getVaultsDir } from '../utils/paths'

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
      console.log(
        '\nPlace your .vult files in this directory to use them with the CLI.'
      )
      return
    }

    console.log(`📁 Found ${vultFiles.length} vault file(s) in ${vaultsDir}:`)

    // Check each file status

    for (const filePath of vultFiles) {
      try {
        const buffer = await fs.promises.readFile(filePath)
        const file = new File([buffer], path.basename(filePath))

        // Check if encrypted from filename hint
        const fileName = path.basename(filePath)
        const isEncrypted =
          fileName.toLowerCase().includes('password') &&
          !fileName.toLowerCase().includes('nopassword')
        const status = isEncrypted ? '🔐 encrypted' : '🔓 unencrypted'

        console.log(`  📄 ${path.basename(filePath)} (${status})`)
      } catch (error) {
        console.log(
          `  📄 ${path.basename(filePath)} (❓ unknown - ${error instanceof Error ? error.message : 'error'})`
        )
      }
    }

    // Also check for active vault in SDK
    try {
      const sdk = new VultisigSDK()
      const activeVault = sdk.getActiveVault()
      if (activeVault) {
        const summary = activeVault.summary()
        console.log(`\n📍 Active vault: ${summary.name} (${summary.type})`)
      }
    } catch (error) {
      // No active vault
    }
  }
}
