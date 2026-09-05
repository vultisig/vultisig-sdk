import { createServer, type Server } from 'node:http'

import { type WalletCore } from '@trustwallet/wallet-core'
import { getTronChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific/resolvers/tron'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const route = vi.hoisted(() => ({ url: '' }))
vi.mock('@vultisig/core-chain/chains/tron/config', () => ({
  get tronRpcUrl() {
    return route.url
  },
}))

// Keep queryUrl, fetch, parsing and the signing-data resolver real.
describe('Tron signing preparation over HTTP', () => {
  let server: Server
  let response: unknown
  let currentResponse: unknown
  let requests: string[]

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(currentResponse && req.url === '/wallet/getnowblock' ? currentResponse : response))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture port')
    route.url = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  })

  it.each([
    { Error: 'upstream unavailable' },
    { error: 'upstream unavailable' },
    {},
    { block_header: { raw_data: { timestamp: 1_716_000_000_000 } } },
  ])('propagates invalid HTTP-200 block data before a TronSpecific payload exists: %j', async body => {
    response = body
    requests = []
    await expect(
      getTronChainSpecific({
        keysignPayload: { coin: { chain: 'Tron' } } as Parameters<typeof getTronChainSpecific>[0]['keysignPayload'],
        walletCore: {} as WalletCore,
        thirdPartyGasLimitEstimation: 1n,
      })
    ).rejects.toThrow('Invalid Tron block response')
    expect(requests).toEqual(['/wallet/getnowblock'])
  })
  it.each([{ Error: 'upstream unavailable' }, { error: 'upstream unavailable' }, {}, { blockID: 'bad' }])(
    'propagates malformed reference data through the resolver: %j',
    async body => {
      currentResponse = {
        block_header: {
          raw_data: {
            timestamp: 1_716_000_000_000,
            number: 99_000_000,
            version: 30,
            txTrieRoot: '01'.repeat(32),
            parentHash: '02'.repeat(32),
            witness_address: '41' + '03'.repeat(20),
          },
        },
      }
      response = body
      requests = []
      await expect(
        getTronChainSpecific({
          keysignPayload: { coin: { chain: 'Tron' } } as Parameters<typeof getTronChainSpecific>[0]['keysignPayload'],
          walletCore: {} as WalletCore,
          thirdPartyGasLimitEstimation: 1n,
          refBlockBytesHex: '0001',
          refBlockHashHex: 'abcdef0123456789',
        })
      ).rejects.toThrow('Invalid Tron block response')
      expect(requests).toEqual(['/wallet/getnowblock', '/wallet/getblockbynum'])
    }
  )
})
