import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileStorage } from '../../../../src/platforms/node/storage'

const ENV_KEY = 'VULTISIG_CONFIG_DIR'
const savedConfigDir = process.env[ENV_KEY]
const tempDirs: string[] = []

afterEach(() => {
  if (savedConfigDir === undefined) {
    delete process.env[ENV_KEY]
  } else {
    process.env[ENV_KEY] = savedConfigDir
  }
  return Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })))
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

    expect(storage.basePath.endsWith('/.vultisig')).toBe(true)
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
      await fs.rm(basePath, { recursive: true, force: true })
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
      await fs.rm(basePath, { recursive: true, force: true })
    }
  })

  it('serializes ordinary writes with conditional writes across adapter instances', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-file-storage-'))
    tempDirs.push(basePath)
    const conditional = new FileStorage({ basePath })
    const ordinary = new FileStorage({ basePath })
    await conditional.set('vault:shared', { version: 'original' })

    let releaseRead!: () => void
    const readGate = new Promise<void>(resolve => {
      releaseRead = resolve
    })
    let signalRead!: () => void
    const readStarted = new Promise<void>(resolve => {
      signalRead = resolve
    })
    const storageInternals = conditional as unknown as {
      readValue: <T>(key: string) => Promise<T | null>
    }
    const readValue = storageInternals.readValue.bind(conditional) as typeof storageInternals.readValue
    storageInternals.readValue = async <T>(key: string) => {
      signalRead()
      await readGate
      return readValue<T>(key)
    }

    const replacing = conditional.compareAndSet('vault:shared', { version: 'original' }, { version: 'conditional' })
    await readStarted
    let ordinaryFinished = false
    const saving = ordinary.set('vault:shared', { version: 'ordinary' }).then(() => {
      ordinaryFinished = true
    })
    await Promise.resolve()
    expect(ordinaryFinished).toBe(false)

    releaseRead()
    await expect(replacing).resolves.toBe(true)
    await saving
    await expect(conditional.get('vault:shared')).resolves.toEqual({
      version: 'ordinary',
    })
  })

  it('serializes clear with a conditional write', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-file-storage-'))
    tempDirs.push(basePath)
    const conditional = new FileStorage({ basePath })
    const clearing = new FileStorage({ basePath })
    await conditional.set('vault:shared', { version: 'original' })

    let releaseRead!: () => void
    const readGate = new Promise<void>(resolve => {
      releaseRead = resolve
    })
    let signalRead!: () => void
    const readStarted = new Promise<void>(resolve => {
      signalRead = resolve
    })
    const storageInternals = conditional as unknown as {
      readValue: <T>(key: string) => Promise<T | null>
    }
    const readValue = storageInternals.readValue.bind(conditional) as typeof storageInternals.readValue
    storageInternals.readValue = async <T>(key: string) => {
      signalRead()
      await readGate
      return readValue<T>(key)
    }

    const replacing = conditional.compareAndSet('vault:shared', { version: 'original' }, { version: 'conditional' })
    await readStarted
    let clearFinished = false
    const clearPromise = clearing.clear().then(() => {
      clearFinished = true
    })
    await Promise.resolve()
    expect(clearFinished).toBe(false)

    releaseRead()
    await expect(replacing).resolves.toBe(true)
    await clearPromise
    await expect(conditional.get('vault:shared')).resolves.toBeNull()
  })

  it('recovers a lock abandoned by a crashed process', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-file-storage-'))
    tempDirs.push(basePath)
    const lockPath = path.join(basePath, 'vault:shared.json.lock')
    await fs.writeFile(
      lockPath,
      JSON.stringify({
        id: 'crashed-owner',
        pid: 2_147_483_647,
        hostname: os.hostname(),
        processStartedAt: 0,
      })
    )
    const storage = new FileStorage({ basePath })

    await storage.set('vault:shared', { version: 'recovered' })

    await expect(storage.get('vault:shared')).resolves.toEqual({ version: 'recovered' })
  })

  it('recovers an abandoned lock after its PID is reused by this process', async () => {
    const basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-file-storage-'))
    tempDirs.push(basePath)
    await fs.writeFile(
      path.join(basePath, 'vault:shared.json.lock'),
      JSON.stringify({
        id: 'previous-process-with-reused-pid',
        pid: process.pid,
        hostname: os.hostname(),
        processStartedAt: performance.timeOrigin - 1,
      })
    )
    const storage = new FileStorage({ basePath })

    await storage.set('vault:shared', { version: 'recovered-after-pid-reuse' })

    await expect(storage.get('vault:shared')).resolves.toEqual({ version: 'recovered-after-pid-reuse' })
  })

  it('uses a process-start identity shared with worker threads', async () => {
    const workerIdentity = await new Promise<{ pid: number; processStartedAt: number }>((resolve, reject) => {
      const worker = new Worker(
        `const { performance } = require('perf_hooks');
         const { parentPort } = require('worker_threads');
         parentPort.postMessage({ pid: process.pid, processStartedAt: performance.timeOrigin });`,
        { eval: true }
      )
      worker.once('message', resolve)
      worker.once('error', reject)
    })

    expect(workerIdentity).toEqual({
      pid: process.pid,
      processStartedAt: performance.timeOrigin,
    })
  })
})
