import {
  AbstractSigner,
  Provider,
  TransactionRequest,
  TransactionResponse,
  TypedDataDomain,
  TypedDataField,
} from 'ethers'
import * as net from 'net'

export interface JsonRpcRequest {
  id: number
  method: 'get_address' | 'sign'
  params: {
    scheme: 'ecdsa'
    curve: 'secp256k1'
    network: 'eth'
    messageType?: 'eth_tx' | 'eth_typed'
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
    raw?: string
  }
  error?: {
    message: string
    code?: number
  }
}

export class VultisigSigner extends AbstractSigner {
  private socketPath: string = '/tmp/vultisig.sock'
  private requestId: number = 1

  constructor(provider?: Provider) {
    super(provider)
  }

  async getAddress(): Promise<string> {
    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'get_address',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'eth'
      }
    }

    const response = await this.sendRequest(request)
    
    if (response.error) {
      throw new Error(`Failed to get address: ${response.error.message}`)
    }

    if (!response.result?.address) {
      throw new Error('No address returned from daemon')
    }

    return response.result.address
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    // Ensure transaction has required fields
    const transaction = {
      to: tx.to,
      value: tx.value ? tx.value.toString() : '0',
      data: tx.data || '0x',
      gasLimit: tx.gasLimit ? tx.gasLimit.toString() : '21000',
      gasPrice: tx.gasPrice ? tx.gasPrice.toString() : undefined,
      maxFeePerGas: tx.maxFeePerGas ? tx.maxFeePerGas.toString() : undefined,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ? tx.maxPriorityFeePerGas.toString() : undefined,
      nonce: tx.nonce,
      type: tx.type || 2, // EIP-1559 by default
      chainId: tx.chainId || 1
    }

    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'sign',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'eth',
        messageType: 'eth_tx',
        payload: transaction
      }
    }

    const response = await this.sendRequest(request)
    
    if (response.error) {
      throw new Error(`Failed to sign transaction: ${response.error.message}`)
    }

    if (!response.result?.signature) {
      throw new Error('No signature returned from daemon')
    }

    return response.result.signature
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>
  ): Promise<string> {
    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'sign',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'eth',
        messageType: 'eth_typed',
        payload: {
          domain,
          types,
          value
        }
      }
    }

    const response = await this.sendRequest(request)
    
    if (response.error) {
      throw new Error(`Failed to sign typed data: ${response.error.message}`)
    }

    if (!response.result?.signature) {
      throw new Error('No signature returned from daemon')
    }

    return response.result.signature
  }

  // Not implemented yet - requires message signing support in daemon
  async signMessage(message: string): Promise<string> {
    throw new Error('Message signing not yet implemented')
  }

  private async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let responseData = ''

      socket.on('connect', () => {
        const requestJson = JSON.stringify(request) + '\n'
        socket.write(requestJson)
      })

      socket.on('data', (data) => {
        responseData += data.toString()
        
        // Check if we have a complete JSON response (ends with newline)
        if (responseData.endsWith('\n')) {
          try {
            const response: JsonRpcResponse = JSON.parse(responseData.trim())
            socket.end()
            resolve(response)
          } catch (error) {
            socket.end()
            reject(new Error(`Failed to parse response: ${error}`))
          }
        }
      })

      socket.on('error', (error) => {
        reject(new Error(`Socket error: ${error.message}`))
      })

      socket.on('timeout', () => {
        socket.destroy()
        reject(new Error('Request timeout'))
      })

      // Set timeout to 30 seconds
      socket.setTimeout(30000)
    })
  }

  // Override connect method to return a new signer with provider
  connect(provider: Provider): VultisigSigner {
    return new VultisigSigner(provider)
  }
}