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

          // For Ethereum, we need to construct a serialized transaction
          let serializedTransaction = signature.signature
          
          if (params?.messageType === 'eth_tx') {
            console.log('🔧 Constructing serialized transaction from signature')
            console.log('📦 Transaction payload:', JSON.stringify(params?.payload, null, 2))

            try {
              // --- ethers v6 canonical path ---
              const { serializeTransaction } = (await import('ethers')) as any

              // --- parse 65-byte signature (r,s,v) from SDK ---
              const sig = signature.signature
              if (sig.length !== 132) throw new Error(`Unexpected sig length: ${sig.length}`)

              let r = '0x' + sig.slice(2, 66)
              let s = '0x' + sig.slice(66, 130)
              const vByte = parseInt(sig.slice(130, 132), 16)

              // Map to yParity ∈ {0,1} for EIP-1559
              let yParity = vByte & 1

              // --- enforce low-s (EIP-2) and flip yParity if needed ---
              const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n // secp256k1 order
              const halfN = N >> 1n
              const sBI = BigInt(s)
              if (sBI > halfN) {
                const sFixed = (N - sBI).toString(16).padStart(64, '0')
                s = '0x' + sFixed
                yParity ^= 1
              }

              // --- normalise tx fields for type-2 (EIP-1559) ---
              const t = params.payload || {}
              const type = t.type ?? 2

              // Fallback if caller provided gasPrice only
              const has1559 = t.maxFeePerGas != null || t.maxPriorityFeePerGas != null
              const maxFeePerGas = has1559
                ? BigInt(t.maxFeePerGas)
                : t.gasPrice != null
                  ? BigInt(t.gasPrice)
                  : 20_000_000_000n // 20 gwei default
              const maxPriorityFeePerGas =
                t.maxPriorityFeePerGas != null
                  ? BigInt(t.maxPriorityFeePerGas)
                  : 2_000_000_000n // 2 gwei default

              // Build ethers v6 tx object; use bigint where appropriate
              const tx: any =
                type === 2
                  ? {
                      type: 2,
                      chainId: t.chainId ?? 1,
                      nonce: t.nonce ?? 0,
                      to: t.to,
                      value: t.value ? BigInt(t.value) : 0n,
                      data: t.data ?? '0x',
                      gasLimit: t.gasLimit ? BigInt(t.gasLimit) : 100000n,
                      maxFeePerGas,
                      maxPriorityFeePerGas,
                      accessList: t.accessList ?? [],
                    }
                  : {
                      // legacy (type 0) path if you ever need it
                      chainId: t.chainId ?? 1,
                      nonce: t.nonce ?? 0,
                      to: t.to,
                      value: t.value ? BigInt(t.value) : 0n,
                      data: t.data ?? '0x',
                      gasLimit: t.gasLimit ? BigInt(t.gasLimit) : 21000n,
                      gasPrice: t.gasPrice ? BigInt(t.gasPrice) : 20_000_000_000n,
                    }

              // --- serialize with signature in ethers v6 shape { r, s, yParity } ---
              const raw = serializeTransaction(tx, { r, s, yParity })

              serializedTransaction = raw

              console.log('✅ Constructed serialized transaction:', raw.slice(0, 20) + '…')
              console.log('📏 Serialized transaction length:', raw.length)
            } catch (error: any) {
              console.error('❌ Failed to construct serialized transaction:', error?.message || error)
              serializedTransaction = signature.signature // fallback (just the sig)
            }
          }

          return {
            id: jsonRpcRequest.id,
            result: {
              signature: signature.signature,
              raw: serializedTransaction
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