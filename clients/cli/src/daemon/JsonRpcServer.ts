// SDK will be made available globally by the launcher
declare const VultisigSDK: any
type VaultClass = any

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
  private vault: VaultClass

  constructor(vault: VaultClass) {
    this.vault = vault
  }
  
  async handleRequest(request: any): Promise<any> {
    const jsonRpcRequest = request as JsonRpcRequest
    
    try {
      
      switch (jsonRpcRequest.method) {
        case 'get_address':
          const chain = jsonRpcRequest.params?.network || 'ethereum'
          const address = await (this.vault as any).address(chain)
          const summary = (this.vault as any).summary()
          
          return {
            id: jsonRpcRequest.id,
            result: {
              address,
              pubkey: summary.id // Use the vault ID as pubkey
            }
          }
          
        case 'sign':
          const signature = await (this.vault as any).signTransaction(
            jsonRpcRequest.params?.payload,
            jsonRpcRequest.params?.network || 'ethereum'
          )
          
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