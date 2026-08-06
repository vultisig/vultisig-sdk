import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FileStorage } from '../../../../src/platforms/node/storage'

const ENV_KEY = 'VULTISIG_CONFIG_DIR'
const savedConfigDir = process.env[ENV_KEY]

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
})
