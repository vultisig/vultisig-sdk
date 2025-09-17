// SDK will be made available globally by the launcher
declare const Vault: any
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
          const params = jsonRpcRequest.params
          const signingMode = params?.signingMode || 'fast'
          const password = params?.password
          
          // Create signing payload for new SDK API
          const signingPayload = {
            transaction: params?.payload,
            chain: params?.network || 'ethereum'
          }
          
          // Use the new .sign() method
          const signature = await (this.vault as any).sign(signingMode, signingPayload, password)
          
          console.log('🔍 Signature result from SDK:', signature)
          console.log('  Type:', typeof signature)
          console.log('  Keys:', Object.keys(signature))
          console.log('  Signature value:', signature.signature)
          console.log('  Format:', signature.format)

          // Return both the DER signature and any serialized transaction
          return {
            id: jsonRpcRequest.id,
            result: {
              signature: signature.signature,
              format: signature.format,
              recovery: signature.recovery,
              raw: signature.signature // For now, return the DER signature as raw
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