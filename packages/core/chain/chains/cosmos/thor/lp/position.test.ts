import { afterEach, describe, expect, it, vi } from 'vitest'

import { getThorchainLpPosition } from './position'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

type MockEntry = { body: unknown; status?: number }

const mockSequence = (entries: MockEntry[]) => {
  let i = 0
  globalThis.fetch = vi.fn(async () => {
    const entry = entries[i++]
    if (!entry) throw new Error('unexpected fetch call')
    return new Response(JSON.stringify(entry.body), {
      status: entry.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

describe('getThorchainLpPosition', () => {
  const input = { thorAddress: 'thor1test', pool: 'SOL.SOL' }

  it('returns the matching midgard position when present', async () => {
    mockSequence([
      {
        body: {
          pools: [
            {
              pool: 'SOL.SOL',
              liquidityUnits: '49181684',
              runeAdded: '100000000',
              assetAdded: '0',
              runePending: '0',
              assetPending: '0',
              runeAddress: 'thor1test',
              assetAddress: '95NBfhAF...',
              dateLastAdded: '1712000000',
            },
          ],
        },
      },
    ])
    const pos = await getThorchainLpPosition(input)
    expect(pos?.liquidityUnits).toBe('49181684')
    expect(pos?.isPending).toBe(false)
  })

  it('falls back to thornode when midgard 404s and surfaces pending state', async () => {
    mockSequence([
      { body: { message: 'not found' }, status: 404 },
      {
        body: {
          asset: 'SOL.SOL',
          rune_address: 'thor1test',
          asset_address: '95NBfhAF...',
          units: '0',
          pending_rune: '100000000',
          pending_asset: '0',
          pending_tx_id: '4C82835E...',
          last_add_height: 25712470,
        },
      },
    ])
    const pos = await getThorchainLpPosition(input)
    expect(pos).not.toBeNull()
    expect(pos?.liquidityUnits).toBe('0')
    expect(pos?.runePending).toBe('100000000')
    expect(pos?.isPending).toBe(true)
    // Thornode returns block height, not Unix seconds. dateLastAdded
    // stays '0' and the block height lives on lastAddHeight so lockup
    // checks can use either source.
    expect(pos?.dateLastAdded).toBe('0')
    expect(pos?.lastAddHeight).toBe('25712470')
  })

  it('falls back to thornode when midgard has the address but not the pool', async () => {
    mockSequence([
      {
        body: {
          pools: [
            {
              pool: 'BTC.BTC',
              liquidityUnits: '1',
              runeAdded: '1',
              assetAdded: '1',
              dateLastAdded: '1700000000',
            },
          ],
        },
      },
      {
        body: {
          asset: 'SOL.SOL',
          rune_address: 'thor1test',
          units: '0',
          pending_rune: '100000000',
          pending_asset: '0',
        },
      },
    ])
    const pos = await getThorchainLpPosition(input)
    expect(pos?.pool).toBe('SOL.SOL')
    expect(pos?.isPending).toBe(true)
  })

  it('returns null when both midgard and thornode are empty', async () => {
    mockSequence([
      { body: { message: 'not found' }, status: 404 },
      {
        body: {
          asset: 'SOL.SOL',
          rune_address: 'thor1test',
          units: '0',
          pending_rune: '0',
          pending_asset: '0',
        },
      },
    ])
    const pos = await getThorchainLpPosition(input)
    expect(pos).toBeNull()
  })

  it('returns null when thornode itself returns 404', async () => {
    mockSequence([
      { body: { message: 'not found' }, status: 404 },
      { body: { message: 'not found' }, status: 404 },
    ])
    const pos = await getThorchainLpPosition(input)
    expect(pos).toBeNull()
  })
})
