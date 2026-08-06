import { chmod, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { _resetAll, setFilePassphrase, setServerPassword } from '../credential-store'

describe('credential file fallback directory permissions', () => {
  const originalConfigDir = process.env.VULTISIG_CONFIG_DIR
  let tempRoot: string

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vultisig-credentials-'))
    _resetAll()
    setFilePassphrase('test-passphrase')
  })

  afterEach(async () => {
    _resetAll()
    if (originalConfigDir === undefined) {
      delete process.env.VULTISIG_CONFIG_DIR
    } else {
      process.env.VULTISIG_CONFIG_DIR = originalConfigDir
    }
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('creates the credential directory with owner-only permissions', async () => {
    const configDir = join(tempRoot, 'config')
    const originalUmask = process.umask(0)
    process.env.VULTISIG_CONFIG_DIR = configDir

    try {
      await setServerPassword('vault', 'secret')

      expect((await stat(configDir)).mode & 0o777).toBe(0o700)
    } finally {
      process.umask(originalUmask)
    }
  })

  it('best-effort tightens an existing credential directory', async () => {
    const configDir = join(tempRoot, 'config')
    await mkdir(configDir, { mode: 0o755 })
    await chmod(configDir, 0o755)
    process.env.VULTISIG_CONFIG_DIR = configDir

    await setServerPassword('vault', 'secret')

    expect((await stat(configDir)).mode & 0o777).toBe(0o700)
  })
})
