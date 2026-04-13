import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getThorchainLpHaltStatus,
  getThorchainLpHaltStatusAll,
} from './halts'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockInbound = (entries: Array<Record<string, unknown>>) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(entries), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

const greenFlags = {
  halted: false,
  chain_trading_paused: false,
  chain_lp_actions_paused: false,
  global_trading_paused: false,
}

describe('getThorchainLpHaltStatusAll', () => {
  it('returns a green status for every unhalted chain', async () => {
    mockInbound([
      { chain: 'BTC', ...greenFlags, address: 'bc1q' },
      { chain: 'ETH', ...greenFlags, address: '0xabc' },
    ])

    const statuses = await getThorchainLpHaltStatusAll()
    expect(statuses).toHaveLength(2)
    expect(statuses[0].chain).toBe('BTC')
    expect(statuses[0].depositable).toBe(true)
    expect(statuses[0].withdrawable).toBe(true)
    expect(statuses[0].reasons).toEqual([])
  })

  it('flags chain_lp_actions_paused on both gates', async () => {
    mockInbound([
      {
        chain: 'ETH',
        halted: false,
        chain_trading_paused: false,
        chain_lp_actions_paused: true,
        global_trading_paused: false,
        address: '0xabc',
      },
    ])

    const [status] = await getThorchainLpHaltStatusAll()
    expect(status.depositable).toBe(false)
    expect(status.withdrawable).toBe(false)
    expect(status.reasons).toContain('ETH LP actions paused')
  })

  it('flags halted chain on both gates + includes reason', async () => {
    mockInbound([
      {
        chain: 'DOGE',
        halted: true,
        chain_trading_paused: false,
        chain_lp_actions_paused: false,
        global_trading_paused: false,
        address: 'D...',
      },
    ])

    const [status] = await getThorchainLpHaltStatusAll()
    expect(status.depositable).toBe(false)
    expect(status.withdrawable).toBe(false)
    expect(status.reasons).toContain('DOGE chain is halted')
  })

  it('global_trading_paused blocks deposits but not withdraws', async () => {
    mockInbound([
      {
        chain: 'BTC',
        halted: false,
        chain_trading_paused: false,
        chain_lp_actions_paused: false,
        global_trading_paused: true,
        address: 'bc1q',
      },
    ])

    const [status] = await getThorchainLpHaltStatusAll()
    expect(status.depositable).toBe(false)
    expect(status.withdrawable).toBe(true)
  })

  it('chain_trading_paused blocks deposits but not withdraws', async () => {
    mockInbound([
      {
        chain: 'BTC',
        halted: false,
        chain_trading_paused: true,
        chain_lp_actions_paused: false,
        global_trading_paused: false,
        address: 'bc1q',
      },
    ])

    const [status] = await getThorchainLpHaltStatusAll()
    expect(status.depositable).toBe(false)
    expect(status.withdrawable).toBe(true)
  })

  it('accumulates multiple reasons when several flags are set', async () => {
    mockInbound([
      {
        chain: 'BTC',
        halted: true,
        chain_trading_paused: true,
        chain_lp_actions_paused: true,
        global_trading_paused: true,
        address: 'bc1q',
      },
    ])

    const [status] = await getThorchainLpHaltStatusAll()
    expect(status.reasons.length).toBe(4)
  })
})

describe('getThorchainLpHaltStatus', () => {
  it('finds a specific chain by uppercase match', async () => {
    mockInbound([
      { chain: 'BTC', ...greenFlags, address: 'bc1q' },
      { chain: 'ETH', ...greenFlags, address: '0xabc' },
      { chain: 'DOGE', ...greenFlags, address: 'D...' },
    ])

    const status = await getThorchainLpHaltStatus('ETH')
    expect(status.chain).toBe('ETH')
    expect(status.depositable).toBe(true)
  })

  it('is case-insensitive on the lookup', async () => {
    mockInbound([{ chain: 'BTC', ...greenFlags, address: 'bc1q' }])
    const status = await getThorchainLpHaltStatus('btc')
    expect(status.chain).toBe('BTC')
  })

  it('throws for unknown chains', async () => {
    mockInbound([{ chain: 'BTC', ...greenFlags, address: 'bc1q' }])
    await expect(getThorchainLpHaltStatus('ZZZ')).rejects.toThrow(/not found/)
  })
})
