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
  })

  describe('getConfigPath', () => {
    it('returns the expected path', () => {
      expect(getConfigPath()).toBe(CONFIG_PATH)
    })
  })

  describe('loadConfig', () => {
    it('returns empty config when file does not exist', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
      const config = await loadConfig()
      expect(config).toEqual({ vaults: [] })
    })

    it('parses existing config file', async () => {
      const existing = makeConfig([makeVault()])
      mockFs.readFile.mockResolvedValue(JSON.stringify(existing))
      const config = await loadConfig()
      expect(config.vaults).toHaveLength(1)
      expect(config.vaults[0].id).toBe('vault-1')
    })
  })

  describe('saveConfig', () => {
    it('creates directory and writes JSON', async () => {
      const config = makeConfig([makeVault()])
      await saveConfig(config)
      expect(mockFs.mkdir).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true })
      expect(mockFs.writeFile).toHaveBeenCalledWith(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
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
      expect(mockFs.mkdir).toHaveBeenCalledWith(overrideDir, { recursive: true })
      expect(mockFs.writeFile).toHaveBeenCalledWith(overridePath, JSON.stringify(config, null, 2), 'utf-8')

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
