import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the fs module to avoid touching real filesystem
vi.mock('node:fs/promises')

const CONFIG_DIR = path.join(os.homedir(), '.vultisig')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

// Import after mocking
import type { VaultEntry, VsigConfig } from '../src/core/config-store'
import { getConfigPath, loadConfig, saveConfig } from '../src/core/config-store'

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
})
