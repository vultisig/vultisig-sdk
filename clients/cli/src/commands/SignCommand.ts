import * as fs from 'fs'
import { VaultManager } from '../vultisig-sdk-mocked'
import { DaemonManager } from '../daemon/DaemonManager'

export interface SignOptions {
  network: string
  mode?: string
  sessionId?: string
  payloadFile?: string
  fast?: boolean
  password?: string
}

export class SignCommand {
  readonly description = 'Sign blockchain transactions using MPC'
  
  async run(options: SignOptions): Promise<void> {
    // Validate required parameters
    if (!options.network) {
      throw new Error('--network is required')
    }
    
    // Validate fast mode requirements
    if (options.fast && !options.password) {
      throw new Error('--password is mandatory when using --fast mode')
    }
    
    const mode = options.mode || 'relay'
    if (mode !== 'local' && mode !== 'relay' && mode !== 'fast') {
      throw new Error('--mode must be "local", "relay", or "fast"')
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
        password: options.password
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
    const activeVault = VaultManager.getActive()
    if (!activeVault) {
      throw new Error('No active vault found and no daemon running. Start with "vultisig run" first.')
    }
    
    try {
      const signature = await activeVault.sign({
        transaction: payloadData,
        chain: options.network,
        signingMode: mode as any
      })
      
      console.log('\n✅ Transaction signed successfully!')
      console.log('📝 Signature:', signature.signature)
      
      if (signature.txHash) {
        console.log('🔗 Transaction Hash:', signature.txHash)
      }
      
    } catch (error) {
      console.error('❌ Signing failed:', error instanceof Error ? error.message : error)
      throw error
    }
  }
  
  private async readFromStdin(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      
      process.stdin.on('data', (chunk) => {
        chunks.push(chunk)
      })
      
      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks))
      })
      
      process.stdin.on('error', (error) => {
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
      'bitcoin': "m/84'/0'/0'/0/0",
      'ethereum': "m/44'/60'/0'/0/0", 
      'solana': "m/44'/501'/0'/0'",
      'litecoin': "m/84'/2'/0'/0/0",
      'dogecoin': "m/44'/3'/0'/0/0"
    }
    
    return paths[network.toLowerCase()] || "m/44'/0'/0'/0/0"
  }
}