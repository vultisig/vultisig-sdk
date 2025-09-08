import * as net from 'net'

export type JsonRpcRequest = {
  id: number
  method: 'get_address' | 'sign'
  params: {
    scheme: 'ecdsa'
    curve: 'secp256k1'
    network: 'btc'
    messageType?: 'btc_psbt'
    payload?: {
      psbtBase64: string
    }
    policyContext?: any
  }
}

export type JsonRpcResponse = {
  id: number
  result?: {
    address?: string
    pubkey?: string
    signedPsbtBase64?: string
    finalTxHex?: string
  }
  error?: {
    message: string
    code?: number
  }
}

export type SignPsbtResult = {
  signedPsbtBase64?: string
  finalTxHex?: string
}

export class VultisigSigner {
  private socketPath: string = '/tmp/vultisig.sock'
  private requestId: number = 1

  async address(): Promise<string> {
    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'get_address',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'btc',
      },
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

  async sign(psbtBase64: string): Promise<SignPsbtResult> {
    const request: JsonRpcRequest = {
      id: this.requestId++,
      method: 'sign',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'btc',
        messageType: 'btc_psbt',
        payload: {
          psbtBase64,
        },
      },
    }

    const response = await this.sendRequest(request)

    if (response.error) {
      throw new Error(`Failed to sign PSBT: ${response.error.message}`)
    }

    return {
      signedPsbtBase64: response.result?.signedPsbtBase64,
      finalTxHex: response.result?.finalTxHex,
    }
  }

  private async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath)
      let responseData = ''

      socket.on('connect', () => {
        const requestJson = JSON.stringify(request) + '\n'
        socket.write(requestJson)
      })

      socket.on('data', data => {
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

      socket.on('error', error => {
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
