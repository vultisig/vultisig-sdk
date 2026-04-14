import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getThorchainLpPositions } from './positions'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetchJson = (body: unknown, status = 200) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

const mockFetchThrows = (err: unknown) => {
  globalThis.fetch = vi.fn(async () => {
    throw err
  }) as typeof fetch
}

describe('getThorchainLpPositions', () => {
  it('returns normalized positions for every pool in the midgard response', async () => {
    mockFetchJson({
      pools: [
        {
          pool: 'BTC.BTC',
          liquidityUnits: '1234567890',
          runeAdded: '100000000',
          assetAdded: '10000',
          runePending: '0',
          assetPending: '0',
          runeAddress: 'thor1test',
          assetAddress: 'bc1qtest',
          dateLastAdded: '1700000000',
        },
        {
          pool: 'ETH.ETH',
          liquidityUnits: '9876543210',
          runeAdded: '200000000',
          assetAdded: '5000000',
          dateLastAdded: '1700000100',
        },
      ],
    })

    const positions = await getThorchainLpPositions({
      thorAddress: 'thor1test',
    })

    expect(positions).toHaveLength(2)
    expect(positions[0].pool).toBe('BTC.BTC')
    expect(positions[0].liquidityUnits).toBe('1234567890')
    expect(positions[0].isPending).toBe(false)
    expect(positions[1].pool).toBe('ETH.ETH')
  })

  it('flags a position as pending when runePending > 0', async () => {
    mockFetchJson({
      pools: [
        {
          pool: 'BTC.BTC',
          liquidityUnits: '0',
          runePending: '500000',
          assetPending: '0',
          runeAdded: '0',
          assetAdded: '0',
        },
      ],
    })

    const positions = await getThorchainLpPositions({
      thorAddress: 'thor1test',
    })
    expect(positions[0].isPending).toBe(true)
  })

  const httpError = (status: number): HttpResponseError =>
    new HttpResponseError({
      message: `HTTP ${status}`,
      status,
      statusText: status === 404 ? 'Not Found' : 'Server Error',
      url: 'https://midgard.ninerealms.com/v2/member/test',
      body: null,
    })

  it('returns an empty array on 404 (address has no positions)', async () => {
    mockFetchThrows(httpError(404))
    const positions = await getThorchainLpPositions({
      thorAddress: 'thor1fresh',
    })
    expect(positions).toEqual([])
  })

  it('returns an empty array when the response has no pools field', async () => {
    mockFetchJson({})
    const positions = await getThorchainLpPositions({
      thorAddress: 'thor1test',
    })
    expect(positions).toEqual([])
  })

  it('bubbles non-404 errors', async () => {
    mockFetchThrows(httpError(500))
    await expect(
      getThorchainLpPositions({ thorAddress: 'thor1test' })
    ).rejects.toThrow()
  })

  it('backfills missing numeric fields with zero strings', async () => {
    mockFetchJson({
      pools: [
        {
          pool: 'BTC.BTC',
          // nothing else set
        },
      ],
    })
    const positions = await getThorchainLpPositions({
      thorAddress: 'thor1test',
    })
    expect(positions[0].liquidityUnits).toBe('0')
    expect(positions[0].runeAdded).toBe('0')
    expect(positions[0].runePending).toBe('0')
    expect(positions[0].isPending).toBe(false)
  })
})
