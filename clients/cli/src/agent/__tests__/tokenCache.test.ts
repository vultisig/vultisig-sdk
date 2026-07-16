import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearCachedToken, getTokenCachePath, loadCachedToken, saveCachedToken, tokenCacheKey } from '../tokenCache'

describe('agent token cache', () => {
  let dir: string

  beforeEach(() => {
    dir = join(tmpdir(), `vsig-token-cache-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    process.env.VULTISIG_CONFIG_DIR = dir
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.VULTISIG_CONFIG_DIR
    rmSync(dir, { recursive: true, force: true })
  })

  const prod = { publicKey: 'pk', backendUrl: 'https://abe.vultisig.com/', profile: '' }
  const staging = { publicKey: 'pk', backendUrl: 'https://staging-abe.vultisig.com', profile: '' }
  const station = { publicKey: 'pk', backendUrl: 'https://abe.vultisig.com', profile: 'station-wallet' }

  it('scopes tokens by public key, normalized backend URL, and profile', async () => {
    await saveCachedToken(prod, 'prod-token', 9_999_999_999)
    await saveCachedToken(staging, 'staging-token', 9_999_999_999)
    await saveCachedToken(station, 'station-token', 9_999_999_999)

    await expect(loadCachedToken(prod)).resolves.toBe('prod-token')
    await expect(loadCachedToken({ ...prod, backendUrl: 'https://abe.vultisig.com' })).resolves.toBe('prod-token')
    await expect(loadCachedToken(staging)).resolves.toBe('staging-token')
    await expect(loadCachedToken(station)).resolves.toBe('station-token')
    expect(new Set([tokenCacheKey(prod), tokenCacheKey(staging), tokenCacheKey(station)]).size).toBe(3)
  })

  it('serializes concurrent mutations behind an exclusive lock and preserves every entry', async () => {
    vi.useFakeTimers()
    const lockPath = `${getTokenCachePath()}.lock`
    writeFileSync(lockPath, 'held by test')

    let settled = 0
    const writes = [prod, staging, station, { ...prod, publicKey: 'pk-2' }].map((scope, i) =>
      saveCachedToken(scope, `token-${i}`, 9_999_999_999).finally(() => {
        settled += 1
      })
    )
    await Promise.resolve()
    expect(settled).toBe(0)
    expect(existsSync(getTokenCachePath())).toBe(false)

    rmSync(lockPath)
    await vi.runAllTimersAsync()
    await Promise.all(writes)

    const persisted = JSON.parse(readFileSync(getTokenCachePath(), 'utf8')) as Record<string, unknown>
    expect(Object.keys(persisted)).toHaveLength(4)
    expect(existsSync(lockPath)).toBe(false)
    expect(readdirSync(dir).some(name => name.startsWith('agent-tokens.json.tmp.'))).toBe(false)
  })

  // A crashed `vsig agent` leaves its lock file behind. Without stale-lock
  // recovery every later invocation waits LOCK_MAX_WAIT_MS and then throws, so
  // one SIGKILL would wedge the cache permanently.
  it('reclaims a stale lock left behind by a crashed process', async () => {
    const lockPath = `${getTokenCachePath()}.lock`
    writeFileSync(lockPath, 'held by a process that died')
    const stale = new Date(Date.now() - 60_000)
    utimesSync(lockPath, stale, stale)

    await saveCachedToken(prod, 'prod-token', 9_999_999_999)

    await expect(loadCachedToken(prod)).resolves.toBe('prod-token')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('does not steal a lock that is still fresh', async () => {
    vi.useFakeTimers()
    const lockPath = `${getTokenCachePath()}.lock`
    writeFileSync(lockPath, 'held by a live sibling')

    const write = saveCachedToken(prod, 'prod-token', 9_999_999_999)
    const outcome = write.then(
      () => 'resolved',
      () => 'rejected'
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(existsSync(getTokenCachePath())).toBe(false)

    rmSync(lockPath)
    await vi.runAllTimersAsync()
    await expect(outcome).resolves.toBe('resolved')
  })

  // The pre-scoped store was keyed by bare publicKey. Those entries are
  // unreachable by every accessor, so a plain round-trip would strand their
  // access AND refresh tokens on disk forever.
  it('reaps unreachable legacy publicKey-keyed entries on the next write', async () => {
    writeFileSync(
      getTokenCachePath(),
      JSON.stringify({
        pk: { token: 'legacy-wrong-env-token', expiresAt: 9_999_999_999, refreshToken: 'legacy-refresh' },
      })
    )

    await saveCachedToken(prod, 'prod-token', 9_999_999_999)

    const persisted = JSON.parse(readFileSync(getTokenCachePath(), 'utf8')) as Record<string, unknown>
    expect(Object.keys(persisted)).toEqual([tokenCacheKey(prod)])
    expect(readFileSync(getTokenCachePath(), 'utf8')).not.toContain('legacy-refresh')
  })

  it('clears only the selected backend/profile scope', async () => {
    await saveCachedToken(prod, 'prod-token', 9_999_999_999)
    await saveCachedToken(station, 'station-token', 9_999_999_999)
    await clearCachedToken(prod)

    await expect(loadCachedToken(prod)).resolves.toBeNull()
    await expect(loadCachedToken(station)).resolves.toBe('station-token')
  })
})
