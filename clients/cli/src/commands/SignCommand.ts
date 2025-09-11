import * as fs from 'fs'
// SDK will be made available globally by the launcher
declare const VultisigSDK: any
import { DaemonManager } from '../daemon/DaemonManager'

export type SignOptions = {
  network: string
  mode?: string
  sessionId?: string
  payloadFile?: string
  password?: string
}

export class SignCommand {
  readonly description = 'Sign blockchain transactions using MPC'

  async run(options: SignOptions): Promise<void> {
    // Validate required parameters
    if (!options.network) {
      throw new Error('--network is required')
    }

    const mode = options.mode || 'fast'
    if (mode !== 'local' && mode !== 'relay' && mode !== 'fast') {
      throw new Error('--mode must be "local", "relay", or "fast"')
    }

    // Validate fast mode requirements
    if (mode === 'fast' && !options.password) {
      throw new Error('--password is required when using fast mode')
    }

    // Read payload
    let payloadData: any
    if (options.payloadFile) {
      const payloadBuffer = await fs.promises.readFile(options.payloadFile)
      try {
        payloadData = JSON.parse(payloadBuffer.toString())
      } catch {
        throw new Error('Payload file must contain valid JSON')
      }
    } else {
      // Read from stdin
      const payloadBuffer = await this.readFromStdin()
      if (payloadBuffer.length === 0) {
        throw new Error('No transaction payload provided')
      }
      try {
        payloadData = JSON.parse(payloadBuffer.toString())
      } catch {
        throw new Error('Payload must be valid JSON')
      }
    }

    console.log('\n🔐 Starting MPC transaction signing...')
    console.log(`Network: ${options.network.toUpperCase()}`)
    console.log(`Mode: ${mode}`)

    // Try daemon first
    try {
      const daemonManager = new DaemonManager()
      const result = await daemonManager.signTransaction({
        network: options.network,
        payload: payloadData,
        signingMode: mode as any,
        sessionId: options.sessionId,
        password: options.password,
      })

      console.log('\n✅ Transaction signed successfully!')
      console.log('📝 Signature:', result.signature)

      if (result.txHash) {
        console.log('🔗 Transaction Hash:', result.txHash)
      }

      if (result.raw) {
        console.log('📋 Raw Transaction:', result.raw)
      }

      return
    } catch (error) {
      console.log('⚠️  Daemon not available, trying direct vault signing...')
    }

    // Fallback to direct vault signing
    const sdk = new VultisigSDK()
    let activeVault = sdk.getActiveVault()
    
    // If no active vault, try to load from vaults directory
    if (!activeVault) {
      console.log('📂 No active vault found, attempting to load from vaults directory...')
      
      const { findVultFiles, getVaultsDir } = await import('../utils/paths')
      const vaultsDir = getVaultsDir()
      const vultFiles = await findVultFiles(vaultsDir)
      
      if (vultFiles.length === 0) {
        throw new Error(`No vault files found in ${vaultsDir}. Start with "vultisig run" first.`)
      }
      
      // Load the first vault file (or HotVault.vult if it exists)
      const hotVaultPath = vultFiles.find(f => f.includes('HotVault.vult'))
      const vaultPath = hotVaultPath || vultFiles[0]
      
      console.log(`📄 Loading vault: ${vaultPath}`)
      
      const buffer = await fs.promises.readFile(vaultPath)
      const file = new File([buffer], require('path').basename(vaultPath))
      ;(file as any).buffer = buffer
      
      // For fast mode, password is required
      if (mode === 'fast' && !options.password) {
        throw new Error('Password is required for fast signing mode')
      }
      
      activeVault = await sdk.addVault(file, options.password)
      console.log('✅ Vault loaded successfully!')
    }

    try {
      // Create proper signing payload
      const signingPayload = {
        transaction: payloadData,
        chain: options.network
      }

      // Use the new sign method
      const signature = await activeVault.sign(mode as any, signingPayload, options.password)

      console.log('\n✅ Transaction signed successfully!')
      console.log('📝 Signature:', signature.signature)
      console.log('📋 Format:', signature.format)

      if (signature.recovery !== undefined) {
        console.log('🔢 Recovery:', signature.recovery)
      }
    } catch (error) {
      console.error(
        '❌ Signing failed:',
        error instanceof Error ? error.message : error
      )
      throw error
    }
  }

  private async readFromStdin(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []

      process.stdin.on('data', chunk => {
        chunks.push(chunk)
      })

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks))
      })

      process.stdin.on('error', error => {
        reject(error)
      })

      // Set timeout for stdin reading
      const timeout = setTimeout(() => {
        reject(new Error('Timeout reading from stdin'))
      }, 5000)

      process.stdin.on('end', () => {
        clearTimeout(timeout)
      })
    })
  }

  private getDerivationPath(network: string): string {
    // Standard derivation paths for different networks
    const paths: Record<string, string> = {
      bitcoin: "m/84'/0'/0'/0/0",
      ethereum: "m/44'/60'/0'/0/0",
      solana: "m/44'/501'/0'/0'",
      litecoin: "m/84'/2'/0'/0/0",
      dogecoin: "m/44'/3'/0'/0/0",
    }

    return paths[network.toLowerCase()] || "m/44'/0'/0'/0/0"
  }
}
