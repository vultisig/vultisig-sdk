import { describe, expect, it } from 'vitest'

import { JsonRpcServer } from './JsonRpcServer'

describe('JsonRpcServer BTC PSBT signing', () => {
  it('returns finalTxHex when messageType is btc_psbt', async () => {
    const mockVault = {
      async sign(_mode: string, _payload: any, _password?: string) {
        return { signature: 'deadbeef', format: 'DER' }
      },
    }

    const server = new JsonRpcServer(mockVault as any)

    const request = {
      id: 1,
      method: 'sign',
      params: {
        scheme: 'ecdsa',
        curve: 'secp256k1',
        network: 'btc',
        messageType: 'btc_psbt',
        payload: { psbtBase64: 'cHNidP8BAQAAAAAB' },
      },
    }

    const response = await server.handleRequest(request)

    expect(response).toBeDefined()
    expect(response.result).toBeDefined()
    expect(response.result.finalTxHex).toBe('deadbeef')
  })
})
