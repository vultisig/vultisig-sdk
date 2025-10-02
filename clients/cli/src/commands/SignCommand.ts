import * as fs from 'fs'
import * as path from 'path'
// SDK will be made available globally by the launcher
declare const Vultisig: any
import { DaemonManager } from '../daemon/DaemonManager'
import { getVaultConfig } from '../utils/env'
import { stripPasswordQuotes } from '../utils/password'

export type SignOptions = {
  network: string
  mode?: string
  sessionId?: string
  payloadFile?: string
  payloadData?: any
  password?: string
  vault?: string
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

    // Get vault configuration with automatic fallback logic
    const vaultConfig = getVaultConfig(options.vault, options.password)
    const strippedPassword = vaultConfig.vaultPassword
      ? stripPasswordQuotes(vaultConfig.vaultPassword)
      : undefined

    // Validate fast mode requirements
    if (mode === 'fast' && !strippedPassword) {
      throw new Error(
        '--password is required when using fast mode (provide via --password or VAULT_PASSWORD in .env)'
      )
    }

    // Read payload from payloadData, file, or stdin
    let payloadData: any
    if (options.payloadData) {
      payloadData = options.payloadData
    } else if (options.payloadFile) {
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

    // Check if daemon is running or if we need to load vault directly
    const daemonManager = new DaemonManager()
    let shouldLoadDirectly = false

    if (vaultConfig.vaultName || strippedPassword) {
      shouldLoadDirectly = await daemonManager.autoStartDaemonIfNeeded({
        vault: vaultConfig.vaultName,
        password: strippedPassword,
      })
    }

    // If daemon is running, use it for signing
    if (!shouldLoadDirectly) {
      try {
        const result = await daemonManager.signTransaction({
          network: options.network,
          payload: payloadData,
          signingMode: mode as any,
          sessionId: options.sessionId,
          password: strippedPassword,
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
        console.log('⚠️  Daemon signing failed:', error instanceof Error ? error.message : error)
        console.log('⚠️  Trying direct vault signing...')
        shouldLoadDirectly = true
      }
    }

    // Load vault directly for this operation
    if (shouldLoadDirectly && (vaultConfig.vaultName || strippedPassword)) {
      try {
        await daemonManager.performEphemeralOperation(
          {
            vault: vaultConfig.vaultName,
            password: strippedPassword,
          },
          async vault => {
            const signingPayload = {
              transaction: payloadData,
              chain: options.network,
            }

            const signature = await vault.signWithPayload(
              signingPayload,
              strippedPassword
            )

            console.log('\n✅ Transaction signed successfully!')
            console.log('📝 Signature:', signature.signature)
            console.log('📋 Format:', signature.format)

            return signature
          }
        )
        return
      } catch (error) {
        console.log(
          '⚠️  Could not perform ephemeral signing operation:',
          error instanceof Error ? error.message : error
        )
      }
    }

    // Fallback to direct vault signing
    const sdk = new Vultisig()
    let activeVault = sdk.getActiveVault()

    // If no active vault, try to load from vaults directory
    if (!activeVault) {
      console.log(
        '📂 No active vault found, attempting to load from vaults directory...'
      )

      const { findVultFiles, getVaultsDir } = await import('../utils/paths')
      const vaultsDir = getVaultsDir()
      const vultFiles = await findVultFiles(vaultsDir)

      if (vultFiles.length === 0) {
        throw new Error(
          `No vault files found in ${vaultsDir}. Start with "vultisig run" first.`
        )
      }

      // Load the first vault file (or HotVault.vult if it exists)
      const hotvaultName = vultFiles.find(f => f.includes('HotVault.vult'))
      const vaultName = hotvaultName || vultFiles[0]

      console.log(`📄 Loading vault: ${vaultName}`)

      const buffer = await fs.promises.readFile(vaultName)
      const file = new File([buffer], path.basename(vaultName))
      ;(file as any).buffer = buffer

      // For fast mode, password is required
      if (mode === 'fast' && !strippedPassword) {
        throw new Error('Password is required for fast signing mode')
      }

      activeVault = await sdk.addVault(file, strippedPassword)
      console.log('✅ Vault loaded successfully!')
    }

    try {
      // Create proper signing payload
      const signingPayload = {
        transaction: payloadData,
        chain: options.network,
      }

      // Use the new signWithPayload method that handles raw transaction data
      const signature = await activeVault.signWithPayload(
        signingPayload,
        strippedPassword
      )

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
