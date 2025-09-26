// SDK will be made available globally by the launcher
type VaultClass = any

export type JsonRpcRequest = {
  id: number
  method: string
  params: any
}

export type JsonRpcResponse = {
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
        case 'get_address': {
          const chain = jsonRpcRequest.params?.network || 'ethereum'
          const address = await (this.vault as any).address(chain)
          const summary = (this.vault as any).summary()

          return {
            id: jsonRpcRequest.id,
            result: {
              address,
              pubkey: summary.id, // Use the vault ID as pubkey
            },
          }
        }

        case 'sign': {
          const params = jsonRpcRequest.params
          const signingMode = params?.signingMode || 'fast'
          const password = params?.password

          // Create signing payload for new SDK API
          const signingPayload = {
            transaction: params?.payload,
            chain: params?.network || 'ethereum',
          }

          // Use the new .sign() method
          const signature = await (this.vault as any).sign(
            signingMode,
            signingPayload,
            password
          )

          console.log('🔍 Signature result from SDK:', signature)
          console.log('  Type:', typeof signature)
          console.log('  Keys:', Object.keys(signature))
          console.log('  Signature value:', signature.signature)
          console.log('  Format:', signature.format)

          // Create complete serialized transaction for immediate broadcast
          let serializedTransaction = signature.signature

          if (params?.messageType === 'eth_tx') {
            try {
              const { serializeTransaction } = await import('viem')

              // Parse DER signature to get r, s, v components
              const sig = signature.signature
              console.log(
                '🔧 Creating serialized transaction from DER signature...'
              )

              if (signature.format === 'ECDSA' && sig.length >= 140) {
                // Parse DER signature
                const rLength = parseInt(sig.substr(6, 2), 16)
                const rHex = sig.substr(8, rLength * 2)
                const sStart = 8 + rLength * 2 + 4
                const sLength = parseInt(sig.substr(sStart - 2, 2), 16)
                const sHex = sig.substr(sStart, sLength * 2)

                const r = '0x' + rHex.padStart(64, '0')
                const s = '0x' + sHex.padStart(64, '0')
                const v = (signature.recovery || 0) + 27

                // Create complete transaction with signature
                const tx = params.payload
                const completeTransaction = {
                  type: 'eip1559' as const,
                  chainId: tx.chainId,
                  nonce: tx.nonce,
                  to: tx.to,
                  value: BigInt(tx.value),
                  data: tx.data || '0x',
                  gas: BigInt(tx.gasLimit),
                  maxFeePerGas: BigInt(tx.maxFeePerGas || tx.gasPrice),
                  maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas || '0'),
                  accessList: [],
                  r: r.startsWith('0x')
                    ? (r as `0x${string}`)
                    : (`0x${r}` as `0x${string}`),
                  s: s.startsWith('0x')
                    ? (s as `0x${string}`)
                    : (`0x${s}` as `0x${string}`),
                  v: BigInt(v),
                }

                // Serialize the complete signed transaction
                serializedTransaction =
                  serializeTransaction(completeTransaction)
                console.log(
                  '✅ Complete signed transaction created for broadcast'
                )
                console.log(
                  '📏 Length:',
                  serializedTransaction.length,
                  'characters'
                )
              }
            } catch (error) {
              console.log(
                '❌ Failed to create serialized transaction:',
                error.message
              )
              console.log('📝 Falling back to DER signature')
            }
          }

          // Return BTC final hex when PSBT signing requested
          if (params?.messageType === 'btc_psbt') {
            return {
              id: jsonRpcRequest.id,
              result: {
                signedPsbtBase64: undefined, // optional: could add if we later keep PSBT flow
                finalTxHex: serializedTransaction,
              },
            }
          }

          return {
            id: jsonRpcRequest.id,
            result: {
              signature: signature.signature,
              format: signature.format,
              recovery: signature.recovery,
              raw: serializedTransaction, // Complete serialized transaction ready for broadcast
            },
          }
        }

        default:
          return {
            id: jsonRpcRequest.id,
            error: {
              message: `Unknown JSON-RPC method: ${jsonRpcRequest.method}`,
              code: -32601,
            },
          }
      }
    } catch (error) {
      return {
        id: jsonRpcRequest?.id || 0,
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          code: -32603,
        },
      }
    }
  }
}
