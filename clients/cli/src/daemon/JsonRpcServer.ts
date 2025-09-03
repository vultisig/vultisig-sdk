import * as net from 'net'
import { VaultData } from '../vault/VaultLoader'
import { SigningManager, SigningRequest } from '../signing/SigningManager'

export interface JsonRpcRequest {
  id: number
  method: 'get_address' | 'sign'
  params: {
    scheme: 'ecdsa' | 'eddsa'
    curve: 'secp256k1' | 'ed25519'
    network: string
    messageType?: string
    payload?: any
    policyContext?: any
  }
}

export interface JsonRpcResponse {
  id: number
  result?: {
    address?: string
    pubkey?: string
    signature?: string
    signedPsbtBase64?: string
    finalTxHex?: string
    raw?: string
  }
  error?: {
    message: string
    code?: number
  }
}

export class JsonRpcServer {
  private server: net.Server
  private vault: VaultData
  private signingManager: SigningManager
  
  constructor(vault: VaultData) {
    this.vault = vault
    this.server = net.createServer()
    this.signingManager = new SigningManager(vault)
  }

  start(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('connection', (socket) => {
        console.log('📡 JSON-RPC client connected')
        
        let buffer = ''
        
        socket.on('data', (data) => {
          buffer += data.toString()
          
          // Process complete requests (newline-delimited)
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.trim()) {
              this.handleRequest(line.trim(), socket)
            }
          }
        })
        
        socket.on('error', (error) => {
          console.error('📡 Socket error:', error.message)
        })
        
        socket.on('close', () => {
          console.log('📡 JSON-RPC client disconnected')
        })
      })
      
      this.server.listen(socketPath, () => {
        console.log(`📡 JSON-RPC server listening on ${socketPath}`)
        resolve()
      })
      
      this.server.on('error', (error) => {
        reject(error)
      })
    })
  }
  
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('📡 JSON-RPC server stopped')
        resolve()
      })
    })
  }
  
  // Public method to handle request directly (used by DaemonManager)
  async handleRequestDirectly(requestLine: string, socket: net.Socket): Promise<void> {
    return this.handleRequest(requestLine, socket)
  }
  
  private async handleRequest(requestLine: string, socket: net.Socket) {
    try {
      const request: JsonRpcRequest = JSON.parse(requestLine)
      console.log(`📡 Handling ${request.method} request for ${request.params.network}`)
      
      let response: JsonRpcResponse
      
      switch (request.method) {
        case 'get_address':
          response = await this.handleGetAddress(request)
          break
        case 'sign':
          response = await this.handleSign(request)
          break
        default:
          response = {
            id: request.id,
            error: {
              message: `Unknown method: ${request.method}`,
              code: -32601
            }
          }
      }
      
      const responseJson = JSON.stringify(response) + '\n'
      socket.write(responseJson)
      
    } catch (error) {
      const errorResponse: JsonRpcResponse = {
        id: 0,
        error: {
          message: `Parse error: ${error instanceof Error ? error.message : error}`,
          code: -32700
        }
      }
      
      const responseJson = JSON.stringify(errorResponse) + '\n'
      socket.write(responseJson)
    }
  }
  
  private async handleGetAddress(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      // Import the address derivation logic
      const { AddressDeriver } = await import('../address/AddressDeriver')
      const deriver = new AddressDeriver()
      
      // Map network to chain for address derivation (keep as-is since they match SupportedChain type)
      const networkChainMap: Record<string, string> = {
        'eth': 'eth',
        'btc': 'btc',
        'sol': 'sol',
        'ltc': 'ltc',
        'doge': 'doge',
        'avax': 'avax',
        'matic': 'matic',
        'bsc': 'bsc',
        'opt': 'optimism',
        'arb': 'arbitrum',
        'base': 'base',
        'thor': 'thor',
        'atom': 'atom',
        'maya': 'maya',
        'ada': 'ada',
        'dot': 'dot',
        'xrp': 'xrp',
        'trx': 'trx',
        'sui': 'sui',
        'ton': 'ton'
      }
      
      const chain = networkChainMap[request.params.network.toLowerCase()]
      if (!chain) {
        return {
          id: request.id,
          error: {
            message: `Unsupported network: ${request.params.network}`,
            code: -32602
          }
        }
      }
      
      // Derive addresses for the specified chain
      const addresses = await deriver.deriveAddresses(this.vault, [chain as any])
      
      // The deriver returns addresses with full chain names, so we need to find the right one
      const address = Object.values(addresses)[0] // Get the first (and only) address
      
      if (!address) {
        return {
          id: request.id,
          error: {
            message: `Failed to derive address for ${chain}`,
            code: -32603
          }
        }
      }
      
      return {
        id: request.id,
        result: {
          address,
          pubkey: request.params.scheme === 'ecdsa' ? this.vault.publicKeyEcdsa : this.vault.publicKeyEddsa
        }
      }
      
    } catch (error) {
      return {
        id: request.id,
        error: {
          message: `Address derivation failed: ${error instanceof Error ? error.message : error}`,
          code: -32603
        }
      }
    }
  }
  
  private async handleSign(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      console.log('🔐 Sign request received:')
      console.log(`   Network: ${request.params.network}`)
      console.log(`   Scheme: ${request.params.scheme}/${request.params.curve}`)
      console.log(`   Message Type: ${request.params.messageType}`)
      console.log(`   Payload:`, request.params.payload)
      
      // Validate required parameters
      if (!request.params.messageType) {
        return {
          id: request.id,
          error: {
            message: 'messageType is required',
            code: -32602
          }
        }
      }
      
      if (!request.params.payload) {
        return {
          id: request.id,
          error: {
            message: 'payload is required',
            code: -32602
          }
        }
      }
      
      // Create signing request
      const signingRequest: SigningRequest = {
        scheme: request.params.scheme,
        curve: request.params.curve,
        network: request.params.network,
        messageType: request.params.messageType,
        payload: request.params.payload,
        sessionId: request.params.policyContext?.sessionId,
        serverUrl: request.params.policyContext?.serverUrl,
        hexEncryptionKey: request.params.policyContext?.hexEncryptionKey,
        peers: request.params.policyContext?.peers
      }
      
      // Perform MPC signing
      const result = await this.signingManager.signTransaction(signingRequest)
      
      return {
        id: request.id,
        result: {
          signature: result.signature,
          signedPsbtBase64: result.signedPsbtBase64,
          finalTxHex: result.finalTxHex,
          raw: result.raw
        }
      }
      
    } catch (error) {
      return {
        id: request.id,
        error: {
          message: `Signing failed: ${error instanceof Error ? error.message : error}`,
          code: -32603
        }
      }
    }
  }
}