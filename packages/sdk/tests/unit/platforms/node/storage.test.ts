import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileStorage } from '../../../../src/platforms/node/storage'

const ENV_KEY = 'VULTISIG_CONFIG_DIR'
const savedConfigDir = process.env[ENV_KEY]

const removeTestDirectory = (directory: string) =>
  fs.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })

afterEach(() => {
  if (savedConfigDir === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = savedConfigDir
  }
})

describe('FileStorage', () => {
  it('honors VULTISIG_CONFIG_DIR when basePath is omitted', () => {
    process.env[ENV_KEY] = '/tmp/vultisig-config-dir-node-storage'

    const storage = new FileStorage()

    expect(storage.basePath).toBe('/tmp/vultisig-config-dir-node-storage')
  })

  it('falls back to the default config dir when VULTISIG_CONFIG_DIR is blank', () => {
    process.env[ENV_KEY] = '   '

    const storage = new FileStorage()

    expect(storage.basePath).toBe(path.join(os.homedir(), '.vultisig'))
  })

  it('keeps explicit basePath overrides ahead of VULTISIG_CONFIG_DIR', () => {
    process.env[ENV_KEY] = '/tmp/vultisig-config-dir-node-storage'

    const storage = new FileStorage({ basePath: '/tmp/explicit-vault-dir' })

    expect(storage.basePath).toBe('/tmp/explicit-vault-dir')
  })

  it('round-trips a normal write through the atomic temp file', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-storage-'))

    try {
      const storage = new FileStorage({ basePath })
      const value = { keyshare: 'test-keyshare' }

      await storage.set('vault', value)

      await expect(storage.get('vault')).resolves.toEqual(value)
    } finally {
      await removeTestDirectory(basePath)
    }
  })

  it('conditionally writes one shared value atomically across adapter instances', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-storage-cas-'))

    try {
      const first = new FileStorage({ basePath })
      const second = new FileStorage({ basePath })
      const results = await Promise.all([
        first.compareAndSet('vault:shared', null, { owner: 'first' }),
        second.compareAndSet('vault:shared', null, { owner: 'second' }),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      await expect(first.get('vault:shared')).resolves.toEqual(results[0] ? { owner: 'first' } : { owner: 'second' })
      await expect(first.list()).resolves.toEqual(['vault:shared'])
    } finally {
      await removeTestDirectory(basePath)
    }
  })

  it('releases a crashed process lock without allowing concurrent conditional writers', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-storage-crashed-lock-'))
    const lockPath = path.join(basePath, '.storage.lock')
    const childScript = fileURLToPath(new URL('./fixtures/file-lock-owner.ts', import.meta.url))
    const lockOwner = spawn(process.execPath, ['--import', 'tsx', childScript, lockPath], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'inherit'],
    })

    try {
      const [lockOutput] = (await once(lockOwner.stdout!, 'data')) as [Buffer]
      expect(lockOutput.toString()).toContain('locked')

      const storages = Array.from({ length: 12 }, () => new FileStorage({ basePath }))
      let settled = false
      const pendingResults = Promise.all(
        storages.map((storage, owner) => storage.compareAndSet('vault:shared', null, { owner }))
      ).finally(() => {
        settled = true
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      expect(settled).toBe(false)

      lockOwner.kill('SIGKILL')
      await once(lockOwner, 'exit')
      const results = await pendingResults

      expect(results.filter(Boolean)).toHaveLength(1)
      const winner = results.findIndex(Boolean)
      await expect(storages[0].get('vault:shared')).resolves.toEqual({ owner: winner })
      await expect(storages[0].list()).resolves.toEqual(['vault:shared'])
      const files = await fs.readdir(basePath)
      expect(files).toContain('.storage.lock')
      expect(files).toContain('cache')
      expect(files.filter(file => file.endsWith('.json'))).toHaveLength(1)
      expect(files.some(file => file.endsWith('.tmp'))).toBe(false)
    } finally {
      if (lockOwner.exitCode === null && lockOwner.signalCode === null) {
        lockOwner.kill('SIGKILL')
        await once(lockOwner, 'exit')
      }
      await removeTestDirectory(basePath)
    }
  })

  it('uses one non-identifying lock sentinel across removed keys', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-storage-lock-sentinel-'))

    try {
      const storage = new FileStorage({ basePath })
      await storage.set('vault:first-device', { keyshare: 'first' })
      await storage.set('cache:address:second-device', { address: 'second' })
      await storage.clear()

      await expect(fs.readdir(basePath).then(files => files.sort())).resolves.toEqual(['.storage.lock', 'cache'])
      await expect(fs.readdir(path.join(basePath, 'cache'))).resolves.toEqual([])
    } finally {
      await removeTestDirectory(basePath)
    }
  })

  it('refuses to overwrite a pre-existing temp path', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-storage-'))
    const now = 1_700_000_000_000
    const random = 0.123456789
    vi.spyOn(Date, 'now').mockReturnValue(now)
    vi.spyOn(Math, 'random').mockReturnValue(random)

    const filePath = path.join(basePath, 'vault.json')
    const tempPath = `${filePath}.${process.pid}.${now}.${random.toString(36).slice(2, 8)}.tmp`
    const plantedContent = 'pre-existing file'

    try {
      await fs.writeFile(tempPath, plantedContent)

      await expect(new FileStorage({ basePath }).set('vault', { keyshare: 'secret' })).rejects.toMatchObject({
        cause: { code: 'EEXIST' },
      })
      await expect(fs.readFile(tempPath, 'utf-8')).resolves.toBe(plantedContent)
      await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      vi.restoreAllMocks()
      await removeTestDirectory(basePath)
    }
  })
})
