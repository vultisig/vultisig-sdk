import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the fs module to avoid touching real filesystem
vi.mock('node:fs/promises')

const CONFIG_DIR = path.join(os.homedir(), '.vultisig')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

// Import after mocking
import type { PersistedToken,VaultEntry, VsigConfig } from '../src/core/config-store'
import {
  clearPersistedTokens,
  ensureVaultEntry,
  getConfigPath,
  getVaultEntry,
  loadConfig,
  persistExtraChains,
  persistTokens,
  removePersistedToken,
  saveConfig,
} from '../src/core/config-store'

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

function makeToken(overrides?: Partial<PersistedToken>): PersistedToken {
  return {
    id: '0xtoken1',
    symbol: 'TKN',
    decimals: 18,
    contractAddress: '0xtoken1',
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

  describe('persistTokens', () => {
    it('adds tokens to existing vault entry', async () => {
      const vault = makeVault()
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      const tokens = [makeToken()]
      await persistTokens('vault-1', 'Ethereum', tokens)

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens.Ethereum).toEqual(tokens)
    })

    it('does nothing if vault not found', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))
      await persistTokens('nonexistent', 'Ethereum', [makeToken()])
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })

    it('replaces existing tokens for the chain', async () => {
      const vault = makeVault({ tokens: { Ethereum: [makeToken()] } })
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      const newTokens = [makeToken({ id: '0xnew', contractAddress: '0xnew', symbol: 'NEW' })]
      await persistTokens('vault-1', 'Ethereum', newTokens)

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens.Ethereum).toEqual(newTokens)
    })
  })

  describe('removePersistedToken', () => {
    it('removes a token by contract address', async () => {
      const t1 = makeToken({ contractAddress: '0xA' })
      const t2 = makeToken({ contractAddress: '0xB', symbol: 'B' })
      const vault = makeVault({ tokens: { Ethereum: [t1, t2] } })
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      await removePersistedToken('vault-1', 'Ethereum', '0xA')

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens.Ethereum).toEqual([t2])
    })

    it('deletes chain key when last token removed', async () => {
      const vault = makeVault({ tokens: { Ethereum: [makeToken({ contractAddress: '0xA' })] } })
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      await removePersistedToken('vault-1', 'Ethereum', '0xA')

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens.Ethereum).toBeUndefined()
    })

    it('does nothing if vault or chain not found', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))
      await removePersistedToken('vault-1', 'Ethereum', '0xA')
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe('clearPersistedTokens', () => {
    it('clears tokens for a specific chain', async () => {
      const vault = makeVault({
        tokens: {
          Ethereum: [makeToken()],
          Solana: [makeToken({ contractAddress: '0xSol' })],
        },
      })
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      await clearPersistedTokens('vault-1', 'Ethereum')

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens.Ethereum).toBeUndefined()
      expect(written.vaults[0].tokens.Solana).toBeDefined()
    })

    it('clears all tokens when no chain specified', async () => {
      const vault = makeVault({ tokens: { Ethereum: [makeToken()], Solana: [makeToken()] } })
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([vault])))

      await clearPersistedTokens('vault-1')

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].tokens).toEqual({})
    })

    it('does nothing if vault has no tokens', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))
      await clearPersistedTokens('vault-1')
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe('persistExtraChains', () => {
    it('saves extra chains to vault entry', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))

      await persistExtraChains('vault-1', ['Solana', 'Avalanche'])

      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults[0].extraChains).toEqual(['Solana', 'Avalanche'])
    })

    it('does nothing if vault not found', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))
      await persistExtraChains('nonexistent', ['Solana'])
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe('getVaultEntry', () => {
    it('returns matching vault entry', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([makeVault()])))
      const entry = await getVaultEntry('vault-1')
      expect(entry?.id).toBe('vault-1')
    })

    it('returns undefined if not found', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([])))
      const entry = await getVaultEntry('vault-1')
      expect(entry).toBeUndefined()
    })
  })

  describe('ensureVaultEntry', () => {
    it('creates entry if not found', async () => {
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([])))

      const entry = await ensureVaultEntry('vault-1', 'My Vault', '/tmp/vault.bak')

      expect(entry.id).toBe('vault-1')
      const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string)
      expect(written.vaults).toHaveLength(1)
    })

    it('returns existing entry without saving', async () => {
      const existing = makeVault()
      mockFs.readFile.mockResolvedValue(JSON.stringify(makeConfig([existing])))

      const entry = await ensureVaultEntry('vault-1', 'My Vault', '/tmp/vault.bak')

      expect(entry.id).toBe('vault-1')
      expect(mockFs.writeFile).not.toHaveBeenCalled()
    })
  })
})
