import * as fs from 'fs'
import * as crypto from 'crypto'
import * as net from 'net'
import { MpcServerManager, MpcServerType } from '../keysign/MpcServerManager'

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
    
    // Infer message type from network
    const messageType = this.getMessageTypeForNetwork(options.network)
    
    // Validate mode
    const mode = options.mode || 'relay'
    if (mode !== 'local' && mode !== 'relay') {
      throw new Error('--mode must be "local" or "relay"')
    }
    
    if (options.fast) {
      console.log('⚡ Using fast mode with VultiServer via daemon...')
    } else {
      console.log('📡 Using vault already loaded in daemon...')
    }
    
    // Read payload
    let payloadData: any
    if (options.payloadFile) {
      const payloadBuffer = await fs.promises.readFile(options.payloadFile)
      try {
        payloadData = JSON.parse(payloadBuffer.toString())
      } catch {
        // If not JSON, treat as raw data
        payloadData = { raw: payloadBuffer.toString('hex') }
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
        // If not JSON, treat as raw data
        payloadData = { raw: payloadBuffer.toString('hex') }
      }
    }
    
    // Auto-generate session ID if not provided
    const sessionId = options.sessionId || this.generateSessionID()
    
    console.log('\n🔐 Starting MPC transaction signing...')
    console.log(`Network: ${options.network.toUpperCase()}`)
    console.log(`Message Type: ${messageType}`)
    console.log(`Mode: ${mode}`)
    console.log(`Session ID: ${sessionId}`)
    
    try {
      // Initialize MPC server manager
      const serverManager = new MpcServerManager()
      const serverInfo = serverManager.getServerDisplayInfo(mode as MpcServerType)
      
      console.log(`\n${serverInfo.icon} ${serverInfo.title}: ${serverInfo.description}`)
      
      // Start the appropriate server
      const serverConfig = await serverManager.startServer(mode as MpcServerType, `cli-${sessionId}`)
      console.log(`🌐 MPC Server: ${serverConfig.url}`)
      
      // Connect to running daemon
      console.log('🔌 Connecting to daemon...')
      
      // Setup cleanup on exit
      const cleanup = async () => {
        console.log('\n🧹 Cleaning up services...')
        await serverManager.stopServer()
      }
      
      process.on('SIGINT', async () => {
        await cleanup()
        process.exit(0)
      })
      
      process.on('SIGTERM', async () => {
        await cleanup()
        process.exit(0)
      })
      
      // Connect to daemon
      let socket: net.Socket
      try {
        socket = net.createConnection('/tmp/vultisig.sock')
      } catch (error) {
        throw new Error('No Vultisig daemon running, start with "vultisig run" first')
      }
      
      // Prepare signing request
      const signingRequest = {
        id: Date.now(),
        method: 'sign' as const,
        params: {
          scheme: this.getSchemeForNetwork(options.network),
          curve: this.getCurveForNetwork(options.network),
          network: options.network,
          messageType: messageType,
          payload: payloadData,
          fastMode: options.fast,
          vultiServerPassword: options.fast ? options.password : undefined,
          policyContext: {
            sessionId,
            serverUrl: serverConfig.url,
            hexEncryptionKey: crypto.randomBytes(32).toString('hex'),
            serviceName: serverConfig.serviceName,
            useVultisigRelay: mode === 'relay',
            peers: []
          }
        }
      }
      
      console.log('\n📡 Sending signing request to daemon...')
      
      // Send request and wait for response
      const response = await new Promise<any>((resolve, reject) => {
        let buffer = ''
        
        socket.on('data', (data) => {
          buffer += data.toString()
          
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          
          for (const line of lines) {
            if (line.trim()) {
              try {
                const response = JSON.parse(line.trim())
                resolve(response)
              } catch (error) {
                reject(new Error(`Invalid response: ${line}`))
              }
            }
          }
        })
        
        socket.on('error', (error) => {
          if ((error as any).code === 'ENOENT' || (error as any).code === 'ECONNREFUSED') {
            reject(new Error('No Vultisig daemon running, start with "vultisig run" first'))
          } else {
            reject(error)
          }
        })
        
        socket.on('connect', () => {
          socket.write(JSON.stringify(signingRequest) + '\n')
        })
        
        setTimeout(() => {
          reject(new Error('Signing request timeout'))
        }, 30000) // 30 second timeout
      })
      
      socket.end()
      
      if (response.error) {
        throw new Error(`Signing failed: ${response.error.message}`)
      }
      
      console.log('\n✅ Transaction signed successfully!')
      console.log('📝 Signature:', response.result.signature)
      
      if (response.result.signedPsbtBase64) {
        console.log('📄 Signed PSBT:', response.result.signedPsbtBase64)
      }
      
      if (response.result.finalTxHex) {
        console.log('🔗 Final Transaction:', response.result.finalTxHex)
      }
      
      if (response.result.raw) {
        console.log('📋 Raw Transaction:', response.result.raw)
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
  
  private generateSessionID(): string {
    // Simple session ID generation using crypto random
    return `session-${crypto.randomBytes(8).toString('hex')}`
  }
  
  private getSchemeForNetwork(network: string): 'ecdsa' | 'eddsa' {
    // EdDSA networks
    const eddsaNetworks = ['sol', 'ada', 'ton', 'sui']
    return eddsaNetworks.includes(network.toLowerCase()) ? 'eddsa' : 'ecdsa'
  }
  
  private getCurveForNetwork(network: string): 'secp256k1' | 'ed25519' {
    // Ed25519 networks
    const ed25519Networks = ['sol', 'ada', 'ton', 'sui']
    return ed25519Networks.includes(network.toLowerCase()) ? 'ed25519' : 'secp256k1'
  }
  
  private getMessageTypeForNetwork(network: string): string {
    const networkLower = network.toLowerCase()
    
    // Map networks to their standard message types
    const messageTypeMap: Record<string, string> = {
      // EVM chains - all use eth_tx
      'eth': 'eth_tx',
      'matic': 'eth_tx', 
      'bsc': 'eth_tx',
      'avax': 'eth_tx',
      'opt': 'eth_tx',
      'arb': 'eth_tx',
      'base': 'eth_tx',
      
      // UTXO chains
      'btc': 'btc_psbt',
      'ltc': 'btc_psbt', 
      'doge': 'btc_psbt',
      
      // Other chains
      'sol': 'sol_tx',
      'atom': 'cosmos_tx',
      'thor': 'cosmos_tx',
      'maya': 'cosmos_tx',
      'ada': 'cardano_tx',
      'dot': 'polkadot_tx',
      'xrp': 'ripple_tx',
      'trx': 'tron_tx',
      'sui': 'sui_tx',
      'ton': 'ton_tx'
    }
    
    return messageTypeMap[networkLower] || 'eth_tx'
  }
}