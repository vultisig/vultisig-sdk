import type { Vault } from '../vultisig-sdk-mocked'

export interface JsonRpcRequest {
  id: number
  method: string
  params: any
}

export interface JsonRpcResponse {
  id: number
  result?: any
  error?: {
    message: string
    code?: number
  }
}

export class JsonRpcServer {
  private vault: Vault
  
  constructor(vault: Vault) {
    this.vault = vault
  }
  
  async handleRequest(request: any): Promise<any> {
    const jsonRpcRequest = request as JsonRpcRequest
    
    try {
      
      switch (jsonRpcRequest.method) {
        case 'get_address':
          const chain = jsonRpcRequest.params?.network || 'ethereum'
          const address = await this.vault.address(chain)
          const summary = this.vault.summary()
          
          return {
            id: jsonRpcRequest.id,
            result: {
              address,
              pubkey: summary.keys.ecdsa // Default to ECDSA
            }
          }
          
        case 'sign':
          const signature = await this.vault.sign({
            transaction: jsonRpcRequest.params?.payload,
            chain: jsonRpcRequest.params?.network || 'ethereum',
            signingMode: 'relay' // Default signing mode
          })
          
          return {
            id: jsonRpcRequest.id,
            result: {
              signature: signature.signature,
              raw: signature.txHash
            }
          }
          
        default:
          return {
            id: jsonRpcRequest.id,
            error: {
              message: `Unknown JSON-RPC method: ${jsonRpcRequest.method}`,
              code: -32601
            }
          }
      }
    } catch (error) {
      return {
        id: jsonRpcRequest?.id || 0,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: -32603
        }
      }
    }
  }
}