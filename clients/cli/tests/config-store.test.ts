import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the fs module to avoid touching real filesystem
vi.mock('node:fs/promises')

const CONFIG_DIR = path.join(os.homedir(), '.vultisig')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

// Import after mocking
import type { VaultEntry, VsigConfig } from '../src/core/config-store'
import { getConfigPath, loadConfig, saveConfig } from '../src/core/config-store'
import { getCredentialsPath } from '../src/core/credential-store'

const mockFs = vi.mocked(fs)

function makeConfig(vaults: VaultEntry[]): VsigConfig {
  return { vaults }
}

function makeVault(overrides?: Partial<VaultEntry>): VaultEntry {
  return {
    id: 'vault-1',
    name: 'Test Vault',
    filePath: '/tmp/vault.bak',
    ...overrides,
  }
}

describe('config-store', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.writeFile.mockResolvedValue(undefined)
    mockFs.chmod.mockResolvedValue(undefined)
  })

  describe('getConfigPath', () => {
    it('returns the expected path', () => {
      expect(getConfigPath()).toBe(CONFIG_PATH)
    })
  })

  describe('loadConfig', () => {
    it('returns empty config when file does not exist (silently)', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      mockFs.readFile.mockRejectedValue(enoent)
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = await loadConfig()
      expect(config).toEqual({ vaults: [] })
      // A missing file is the normal first-run case — must not warn.
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('parses existing config file', async () => {
      const existing = makeConfig([makeVault()])
      mockFs.readFile.mockResolvedValue(JSON.stringify(existing))
      const config = await loadConfig()
      expect(config.vaults).toHaveLength(1)
      expect(config.vaults[0].id).toBe('vault-1')
    })

    it('warns (instead of silently reverting) when config is corrupted', async () => {
      // Garbage JSON — a partial write or single-byte corruption. The old code
      // swallowed this and returned defaults with no warning, silently vanishing
      // the vault registry. We must warn AND name the path.
      mockFs.readFile.mockResolvedValue('{ this is not valid json ')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config = await loadConfig()
      expect(config).toEqual({ vaults: [] })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const message = String(warnSpy.mock.calls[0][0])
      expect(message).toContain(CONFIG_PATH)
      expect(message.toLowerCase()).toContain('corrupt')
      warnSpy.mockRestore()
    })

    it('does not overwrite the corrupted file on read', async () => {
      mockFs.readFile.mockResolvedValue('not json')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      await loadConfig()
      // Leave the bad file intact so it stays recoverable.
      expect(mockFs.writeFile).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })
  })

  describe('saveConfig', () => {
    it('creates directory and writes JSON', async () => {
      const config = makeConfig([makeVault()])
      await saveConfig(config)
      expect(mockFs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 })
      expect(mockFs.writeFile).toHaveBeenCalledWith(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
    })

    it('writes config with 0o600 perms and a 0o700 dir', async () => {
      const config = makeConfig([makeVault()])
      await saveConfig(config)
      // Dir hardened to 0o700.
      expect(mockFs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true, mode: 0o700 })
      // File created with 0o600...
      const writeArgs = mockFs.writeFile.mock.calls[0]
      expect(writeArgs[2]).toEqual({ mode: 0o600 })
      // ...and chmod'd 0o600 on every write (mode is honored only on create).
      expect(mockFs.chmod).toHaveBeenCalledWith(CONFIG_PATH, 0o600)
    })

    it('tolerates chmod failure on non-POSIX filesystems', async () => {
      mockFs.chmod.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
      const config = makeConfig([makeVault()])
      await expect(saveConfig(config)).resolves.toBeUndefined()
    })
  })

  describe('VULTISIG_CONFIG_DIR override', () => {
    const ENV_KEY = 'VULTISIG_CONFIG_DIR'
    let savedEnv: string | undefined

    beforeEach(() => {
      savedEnv = process.env[ENV_KEY]
    })

    afterEach(() => {
      if (savedEnv === undefined) delete process.env[ENV_KEY]
      else process.env[ENV_KEY] = savedEnv
    })

    it('resolves config path under the overridden dir, not $HOME/.vultisig', () => {
      const overrideDir = path.join(os.tmpdir(), 'vultisig-config-override')
      process.env[ENV_KEY] = overrideDir

      const resolved = getConfigPath()
      expect(resolved).toBe(path.join(overrideDir, 'config.json'))
      expect(resolved.startsWith(overrideDir)).toBe(true)
      expect(resolved).not.toBe(CONFIG_PATH)
    })

    it('save/load round-trip uses the overridden dir', async () => {
      const overrideDir = path.join(os.tmpdir(), 'vultisig-config-override')
      const overridePath = path.join(overrideDir, 'config.json')
      process.env[ENV_KEY] = overrideDir

      const config = makeConfig([makeVault()])
      await saveConfig(config)
      expect(mockFs.mkdir).toHaveBeenCalledWith(overrideDir, { recursive: true, mode: 0o700 })
      expect(mockFs.writeFile).toHaveBeenCalledWith(overridePath, JSON.stringify(config, null, 2), { mode: 0o600 })

      mockFs.readFile.mockResolvedValue(JSON.stringify(config))
      const loaded = await loadConfig()
      expect(mockFs.readFile).toHaveBeenCalledWith(overridePath, 'utf-8')
      expect(loaded).toEqual(config)
    })

    it('reads the overridden path when the registry is missing', async () => {
      const overrideDir = path.join(os.tmpdir(), 'vultisig-config-override')
      const overridePath = path.join(overrideDir, 'config.json')
      process.env[ENV_KEY] = overrideDir

      mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
      const loaded = await loadConfig()
      expect(mockFs.readFile).toHaveBeenCalledWith(overridePath, 'utf-8')
      expect(loaded).toEqual({ vaults: [] })
    })

    it('co-locates the registry with credentials (same parent dir)', () => {
      const overrideDir = path.join(os.tmpdir(), 'vultisig-config-override')
      process.env[ENV_KEY] = overrideDir

      // Assert against credential-store's real resolver so the two stores stay
      // coupled by the test, not by a hand-copied path expression.
      expect(path.dirname(getConfigPath())).toBe(path.dirname(getCredentialsPath()))
    })
  })
})
