import * as net from 'net'

export interface JsonRpcRequest {
  id: number
  method: 'get_address' | 'sign'
  params: {
    scheme: 'eddsa'
    curve: 'ed25519'
    network: 'sol'
    messageType?: 'sol_tx'
    payload?: {
      bytes: string // base64 encoded
    }
    policyContext?: any
  }
}

export interface JsonRpcResponse {
  id: number
  result?: {
    address?: string
    pubkey?: string
    signature?: string
  }
  error?: {
    message: string
    code?: number
  }
}

export class VultisigSigner {
  private socketPath: string = '/tmp/vultisig.sock'
  private requestId: number = 1

  async getAddress(): Promise<string> {
    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'get_address',
      params: {
        scheme: 'eddsa',
        curve: 'ed25519',
        network: 'sol'
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

  async sign(bytes: Uint8Array): Promise<string> {
    // Convert bytes to base64
    const bytesBase64 = Buffer.from(bytes).toString('base64')

    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'sign',
      params: {
        scheme: 'eddsa',
        curve: 'ed25519',
        network: 'sol',
        messageType: 'sol_tx',
        payload: {
          bytes: bytesBase64
        }
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
}