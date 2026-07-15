import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('clears only the selected backend/profile scope', async () => {
    await saveCachedToken(prod, 'prod-token', 9_999_999_999)
    await saveCachedToken(station, 'station-token', 9_999_999_999)
    await clearCachedToken(prod)

    await expect(loadCachedToken(prod)).resolves.toBeNull()
    await expect(loadCachedToken(station)).resolves.toBe('station-token')
  })
})
