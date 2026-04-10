import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getLpWithdrawReadiness,
  getThorchainLpLockupSeconds,
  THORCHAIN_BLOCK_TIME_SECONDS,
} from './lockup'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

const mockFetchJson = (body: unknown) => {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ) as typeof fetch
}

describe('getThorchainLpLockupSeconds', () => {
  it('multiplies LIQUIDITYLOCKUPBLOCKS by 6-second block time', async () => {
    mockFetchJson({ LIQUIDITYLOCKUPBLOCKS: 600 })
    const seconds = await getThorchainLpLockupSeconds()
    expect(seconds).toBe(3600)
    expect(THORCHAIN_BLOCK_TIME_SECONDS).toBe(6)
  })

  it('handles a zero lockup value', async () => {
    mockFetchJson({ LIQUIDITYLOCKUPBLOCKS: 0 })
    const seconds = await getThorchainLpLockupSeconds()
    expect(seconds).toBe(0)
  })

  it('throws when LIQUIDITYLOCKUPBLOCKS is missing from the mimir response', async () => {
    mockFetchJson({ OTHER_KEY: 42 })
    await expect(getThorchainLpLockupSeconds()).rejects.toThrow(
      /LIQUIDITYLOCKUPBLOCKS/
    )
  })

  it('throws when the mimir response is not an object', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify('not an object'), { status: 200 })
    ) as typeof fetch
    await expect(getThorchainLpLockupSeconds()).rejects.toThrow(
      /unexpected mimir payload/
    )
  })
})

describe('getLpWithdrawReadiness', () => {
  it('reports isWithdrawable=true when the unlock is in the past', async () => {
    const now = 1_700_000_000
    const readiness = await getLpWithdrawReadiness({
      position: { dateLastAdded: String(now - 7200) }, // 2 hours ago
      lockupSeconds: 3600,
      nowUnix: now,
    })
    expect(readiness.isWithdrawable).toBe(true)
    expect(readiness.remainingSeconds).toBe(0)
    expect(readiness.unlockAtUnix).toBe(now - 7200 + 3600)
  })

  it('reports isWithdrawable=false with correct remainingSeconds', async () => {
    const now = 1_700_000_000
    const lastAdded = now - 600 // 10 minutes ago
    const readiness = await getLpWithdrawReadiness({
      position: { dateLastAdded: String(lastAdded) },
      lockupSeconds: 3600,
      nowUnix: now,
    })
    expect(readiness.isWithdrawable).toBe(false)
    expect(readiness.remainingSeconds).toBe(3000) // 50 more minutes
    expect(readiness.unlockAtUnix).toBe(lastAdded + 3600)
  })

  it('treats missing dateLastAdded as withdrawable (unknown/fresh)', async () => {
    const readiness = await getLpWithdrawReadiness({
      position: { dateLastAdded: '0' },
      lockupSeconds: 3600,
      nowUnix: 1_700_000_000,
    })
    expect(readiness.isWithdrawable).toBe(true)
    expect(readiness.remainingSeconds).toBe(0)
  })

  it('treats invalid dateLastAdded as withdrawable', async () => {
    const readiness = await getLpWithdrawReadiness({
      position: { dateLastAdded: 'not-a-number' },
      lockupSeconds: 3600,
      nowUnix: 1_700_000_000,
    })
    expect(readiness.isWithdrawable).toBe(true)
  })

  it('fetches lockupSeconds from mimir when not provided', async () => {
    mockFetchJson({ LIQUIDITYLOCKUPBLOCKS: 600 })
    const readiness = await getLpWithdrawReadiness({
      position: { dateLastAdded: '1000000' },
      nowUnix: 1000001,
    })
    // lockup = 600 * 6 = 3600; unlock at 1000000 + 3600 = 1003600; now = 1000001; remaining = 3599
    expect(readiness.remainingSeconds).toBe(3599)
    expect(readiness.isWithdrawable).toBe(false)
  })
})
