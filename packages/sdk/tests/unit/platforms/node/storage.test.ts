// `FileStorage.set()` is the persistence primitive behind every vault save, and a stored
// vault contains key shares. These tests pin the write itself: the bytes must only ever
// exist in a file this process created, owner-only, and the write must fail closed rather
// than reuse or follow anything already sitting at the temp path.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileStorage } from '../../../../src/platforms/node/storage'

const KEY = 'vault-keyshare-test'
const SECRET = 'KEYSHARE-SECRET-BYTES'

async function modeOf(file: string): Promise<string> {
  const stat = await fs.stat(file)
  return (stat.mode & 0o777).toString(8)
}

describe('FileStorage.set file permissions', () => {
  let basePath: string
  let originalUmask: number

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-storage-mode-'))
    // Force a permissive umask so these read as real assertions about the write rather
    // than about the ambient umask: under a 0077 developer/CI umask a file lands 0600
    // by accident, and the mode assertions below would hold no matter what the code did.
    originalUmask = process.umask(0o022)
  })

  afterEach(async () => {
    process.umask(originalUmask)
    await fs.rm(basePath, { recursive: true, force: true })
    vi.doUnmock('fs/promises')
    vi.resetModules()
  })

  // Load `FileStorage` against a patched `fs/promises` so a specific step of the write
  // can be failed. The temp file the cleanup has to remove only exists at runtime, so
  // there is no way to reach these paths from the outside.
  async function loadStorageWithFailing(
    overrides: (actual: typeof import('fs/promises')) => Record<string, unknown>
  ): Promise<typeof FileStorage> {
    vi.resetModules()
    vi.doMock('fs/promises', async importOriginal => {
      const actual = await importOriginal<typeof import('fs/promises')>()
      return { ...actual, default: actual, ...overrides(actual) }
    })
    return (await import('../../../../src/platforms/node/storage')).FileStorage
  }

  function errnoError(message: string, code: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(message)
    error.code = code
    return error
  }

  it('persists the vault owner-only under a permissive umask', async () => {
    const storage = new FileStorage({ basePath })

    await storage.set(KEY, { keyshare: SECRET })

    const filePath = path.join(basePath, `${KEY}.json`)
    expect(await modeOf(filePath)).toBe('600')
    expect((await fs.lstat(filePath)).isFile()).toBe(true)
    expect(await storage.get(KEY)).toEqual({ keyshare: SECRET })
  })

  it('replaces a pre-existing world-readable vault file with an owner-only one', async () => {
    const filePath = path.join(basePath, `${KEY}.json`)
    await fs.writeFile(filePath, '{}', { mode: 0o644 })
    expect(await modeOf(filePath)).toBe('644')

    await new FileStorage({ basePath }).set(KEY, { keyshare: SECRET })

    expect(await modeOf(filePath)).toBe('600')
    expect((await fs.lstat(filePath)).isFile()).toBe(true)
  })

  it('never persists the vault through a symlink at the destination', async () => {
    // rename() replaces a symlink at the destination rather than following it, so the
    // shares land in the real store and the attacker's target stays untouched.
    const filePath = path.join(basePath, `${KEY}.json`)
    const decoy = path.join(basePath, 'decoy.txt')
    await fs.writeFile(decoy, 'untouched', { mode: 0o644 })
    await fs.symlink(decoy, filePath)

    await new FileStorage({ basePath }).set(KEY, { keyshare: SECRET })

    expect((await fs.lstat(filePath)).isSymbolicLink()).toBe(false)
    expect((await fs.lstat(filePath)).isFile()).toBe(true)
    expect(await modeOf(filePath)).toBe('600')
    expect(await fs.readFile(decoy, 'utf-8')).toBe('untouched')
  })

  it('leaves no temp file behind', async () => {
    await new FileStorage({ basePath }).set(KEY, { keyshare: SECRET })

    expect((await fs.readdir(basePath)).filter(f => f.endsWith('.tmp'))).toEqual([])
  })

  it('cleans up its own temp file when the write fails after the file exists', async () => {
    // Creating the temp file and filling it are separate steps. A failure in between —
    // a full disk is the realistic one — leaves a temp file holding a partial vault that
    // only this call can remove, so the cleanup must key on "we created it", not on the
    // write having completed. Fail the write, keep the real open, and watch the residue.
    const StorageWithFailingWrite = await loadStorageWithFailing(actual => ({
      open: async (...args: Parameters<typeof actual.open>) => {
        const handle = await actual.open(...args)
        handle.writeFile = async () => {
          throw errnoError('no space left on device', 'ENOSPC')
        }
        return handle
      },
    }))

    // ENOSPC still maps to the quota error, so the new structure did not swallow it.
    await expect(new StorageWithFailingWrite({ basePath }).set(KEY, { keyshare: SECRET })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    })

    expect(await fs.readdir(basePath)).toEqual(['cache'])
  })

  it('cleans up its own temp file when the rename fails with EEXIST', async () => {
    // EEXIST specifically: it is the code that means "not ours" for the exclusive create,
    // and rename can raise it too (a directory in the way, or Windows). Cleanup must
    // follow who created the file, not the error code — otherwise this path strands a
    // temp file full of key shares, and nothing else reaps `.tmp` (neither `list()` nor
    // `clear()` looks at them).
    const StorageWithFailingRename = await loadStorageWithFailing(() => ({
      rename: async () => {
        throw errnoError('file exists', 'EEXIST')
      },
    }))

    await expect(new StorageWithFailingRename({ basePath }).set(KEY, { keyshare: SECRET })).rejects.toMatchObject({
      cause: { code: 'EEXIST' },
    })

    expect(await fs.readdir(basePath)).toEqual(['cache'])
  })
})

// The temp file is the whole mechanism, so it needs the same guarantee as the destination.
// `mode` applies only when writeFile CREATES the file, and writeFile follows symlinks — so
// a temp path that can be predicted and pre-created either keeps the attacker's 0644 perms
// or redirects the shares entirely. Hence random bytes in the name and an exclusive create.
describe('FileStorage.set temp file cannot be pre-empted', () => {
  const FIXED_NOW = 1_700_000_000_000
  const PINNED_RANDOM = 'deadbeefcafe'

  let basePath: string
  let originalUmask: number

  beforeEach(async () => {
    basePath = await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-storage-temp-'))
    originalUmask = process.umask(0o022)
  })

  afterEach(async () => {
    process.umask(originalUmask)
    await fs.rm(basePath, { recursive: true, force: true })
    vi.restoreAllMocks()
    vi.resetModules()
    vi.doUnmock('crypto')
  })

  // Pin the random component and the clock so the temp path is knowable, standing in for
  // an attacker who can predict or brute-force it.
  async function loadStorageWithPinnedTempPath(): Promise<{
    storage: { set(key: string, value: unknown): Promise<void> }
    tempPath: string
  }> {
    vi.resetModules()
    vi.doMock('crypto', async importOriginal => ({
      ...(await importOriginal<typeof import('crypto')>()),
      randomBytes: () => Buffer.from(PINNED_RANDOM, 'hex'),
    }))
    const { FileStorage: PinnedFileStorage } = await import('../../../../src/platforms/node/storage')
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)

    const filePath = path.join(basePath, `${KEY}.json`)
    return {
      storage: new PinnedFileStorage({ basePath }),
      tempPath: `${filePath}.${process.pid}.${FIXED_NOW}.${PINNED_RANDOM}.tmp`,
    }
  }

  it('refuses rather than writing the vault into a pre-created temp file', async () => {
    const { storage, tempPath } = await loadStorageWithPinnedTempPath()
    await fs.writeFile(tempPath, '', { mode: 0o644 })
    await fs.chmod(tempPath, 0o644)

    // Assert the cause, not just "it threw": `set()` does other work before the temp
    // write, so a bare rejection would let an unrelated early failure satisfy every
    // assertion below while the path under attack went untested.
    await expect(storage.set(KEY, { keyshare: SECRET })).rejects.toMatchObject({
      cause: { code: 'EEXIST' },
    })

    // The decisive assertion: the shares must never reach the pre-created 0644 file.
    const leaked = await fs.readFile(tempPath, 'utf-8').catch(() => '')
    expect(leaked).not.toContain(SECRET)
    // A file we did not create must also still be there — cleanup must not unlink it.
    expect((await fs.lstat(tempPath)).isFile()).toBe(true)
    // ...and the write must not have silently succeeded to the real store either.
    await expect(fs.access(path.join(basePath, `${KEY}.json`))).rejects.toThrow()
  })

  it('refuses rather than following a symlink planted at the temp path', async () => {
    const { storage, tempPath } = await loadStorageWithPinnedTempPath()
    const attackerTarget = path.join(basePath, 'attacker-target.txt')
    await fs.writeFile(attackerTarget, 'empty', { mode: 0o644 })
    await fs.symlink(attackerTarget, tempPath)

    // An exclusive create refuses a symlink with EEXIST rather than following it —
    // asserting the code keeps an unrelated early failure from standing in for it.
    await expect(storage.set(KEY, { keyshare: SECRET })).rejects.toMatchObject({
      cause: { code: 'EEXIST' },
    })

    // The shares must not have been redirected through the symlink...
    expect(await fs.readFile(attackerTarget, 'utf-8')).toBe('empty')
    // ...the planted symlink must survive (we never created it, so we must not remove it)...
    expect((await fs.lstat(tempPath)).isSymbolicLink()).toBe(true)
    // ...and nothing must have landed in the real store.
    await expect(fs.access(path.join(basePath, `${KEY}.json`))).rejects.toThrow()
  })
})
