import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  provider: vi.fn(),
}))

vi.mock('@polkadot/api', () => {
  mocks.load()
  return {
    ApiPromise: { create: mocks.create },
    HttpProvider: class {
      constructor(url: string) {
        mocks.provider(url)
      }
    },
  }
})

import { rootApiUrl } from '@vultisig/core-config'

import { assetHubRpcUrl, getPolkadotClient, polkadotRpcUrl } from './client'

describe('Polkadot RPC endpoints', () => {
  it('serves Polkadot Asset Hub through the /dot/ proxy', () => {
    expect(polkadotRpcUrl).toBe(`${rootApiUrl}/dot/`)
  })

  it('reads Asset Hub tokens from the same endpoint as native DOT', () => {
    expect(assetHubRpcUrl).toBe(polkadotRpcUrl)
  })

  it('does not use the retired /dot-ah/ proxy, which returns 404', () => {
    expect(assetHubRpcUrl).not.toContain('dot-ah')
  })
})

describe('getPolkadotClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the Polkadot API on first use and reuses the client', async () => {
    expect(mocks.load).not.toHaveBeenCalled()
    const client = { isConnected: true }
    mocks.create.mockResolvedValue(client)

    expect(await getPolkadotClient()).toBe(client)
    expect(await getPolkadotClient()).toBe(client)

    expect(mocks.load).toHaveBeenCalledTimes(1)
    expect(mocks.provider).toHaveBeenCalledWith(polkadotRpcUrl)
    expect(mocks.create).toHaveBeenCalledTimes(1)
  })
})
