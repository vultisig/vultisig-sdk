import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('version config-dir wiring', () => {
  const originalConfigDir = process.env.VULTISIG_CONFIG_DIR
  const originalNoUpdateCheck = process.env.VULTISIG_NO_UPDATE_CHECK
  let tmpConfigDir: string

  beforeEach(() => {
    vi.resetModules()
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'vultisig-version-'))
    process.env.VULTISIG_CONFIG_DIR = tmpConfigDir
    process.env.VULTISIG_NO_UPDATE_CHECK = '1'
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.VULTISIG_CONFIG_DIR
    } else {
      process.env.VULTISIG_CONFIG_DIR = originalConfigDir
    }
    if (originalNoUpdateCheck === undefined) {
      delete process.env.VULTISIG_NO_UPDATE_CHECK
    } else {
      process.env.VULTISIG_NO_UPDATE_CHECK = originalNoUpdateCheck
    }
    rmSync(tmpConfigDir, { recursive: true, force: true })
  })

  // Generous timeout: the dynamic import pulls the client-shared barrel (and through
  // auth-setup, the SDK graph), whose cold vitest transform alone can exceed the 5s default.
  it('writes the version cache under VULTISIG_CONFIG_DIR', { timeout: 20000 }, async () => {
    const version = await import('../version')

    const result = await version.checkForUpdates()

    expect(result).toBeNull()
    const cachePath = join(tmpConfigDir, 'cache', 'version-check.json')
    expect(() => readFileSync(cachePath, 'utf8')).toThrow()

    delete process.env.VULTISIG_NO_UPDATE_CHECK
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '9.9.9' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const liveVersion = await import('../version')
    await liveVersion.checkForUpdates()

    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as { latestVersion: string | null }
    expect(cache.latestVersion).toBe('9.9.9')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports the resolved config dir in detailed version output', async () => {
    const version = await import('../version')

    expect(version.formatVersionDetailed()).toContain(`Config:    ${tmpConfigDir}`)
  })
})
