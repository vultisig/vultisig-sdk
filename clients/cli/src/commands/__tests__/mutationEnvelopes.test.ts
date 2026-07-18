// Mutations always emit an envelope in JSON mode (vultisig-sdk sdkcli2-13 P1-5 / P2-11).
//
// Regression guard: switch/rename/currency/address-book-add/address-book-remove/
// import/export all ended in success(), which JSON mode suppresses — so each exited 0
// with ZERO bytes on stdout, while delete/chains-add DID emit envelopes. A machine
// caller got an empty string back from a successful mutation and could not tell it
// from a no-op.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { FastVault } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../../core'
import { configureOutput, resetOutput } from '../../lib/output'
import { executeAddressBook, executeCurrency } from '../settings'
import {
  executeAddPostQuantumKeys,
  executeExport,
  executeImport,
  executeRename,
  executeSwitch,
} from '../vault-management'

let stdout: string[]
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stdout = []
  writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    stdout.push(String(chunk))
    return true
  })
  configureOutput({ format: 'json' })
})

afterEach(() => {
  writeSpy.mockRestore()
  vi.restoreAllMocks()
  resetOutput()
})

/** Parse the single envelope a mutation is expected to write. */
function envelope(): { success: boolean; v: number; data: Record<string, unknown> } {
  const raw = stdout.join('')
  expect(raw, 'mutation wrote nothing to stdout').not.toBe('')
  return JSON.parse(raw)
}

const vaultStub = {
  id: 'vault-1',
  name: 'Vultisig Cluster #1',
  type: 'fast',
  chains: ['Ethereum', 'Bitcoin'],
}

describe('currency set', () => {
  function makeCtx() {
    return {
      ensureActiveVault: async () => ({ currency: 'usd', setCurrency: vi.fn(async () => {}) }),
    } as unknown as CommandContext
  }

  it('emits a versioned envelope naming the new currency', async () => {
    await executeCurrency(makeCtx(), 'eur')

    const env = envelope()
    expect(env.success).toBe(true)
    expect(env.v).toBe(1)
    expect(env.data).toMatchObject({ currency: 'eur', updated: true })
  })
})

describe('address book mutations', () => {
  function makeCtx() {
    return {
      sdk: {
        addAddressBookEntry: vi.fn(async () => {}),
        removeAddressBookEntry: vi.fn(async () => {}),
      },
    } as unknown as CommandContext
  }

  it('--add emits an envelope describing the stored entry', async () => {
    await executeAddressBook(makeCtx(), {
      add: true,
      chain: 'Ethereum' as never,
      address: '0xabc',
      name: 'treasury',
    })

    expect(envelope().data.added).toMatchObject({ chain: 'Ethereum', address: '0xabc', name: 'treasury' })
  })

  it('--remove emits an envelope naming what was removed', async () => {
    await executeAddressBook(makeCtx(), { remove: '0xabc', chain: 'Ethereum' as never })

    expect(envelope().data.removed).toMatchObject({ address: '0xabc', chain: 'Ethereum' })
  })
})

describe('switch', () => {
  it('emits an envelope identifying the now-active vault', async () => {
    // setupVaultEvents() subscribes to the vault's emitter.
    const vault = { ...vaultStub, on: vi.fn() }
    const ctx = {
      sdk: { getVaultById: vi.fn(async () => vault), listVaults: vi.fn(async () => [vault]) },
      setActiveVault: vi.fn(async () => {}),
    } as unknown as CommandContext

    await executeSwitch(ctx, 'vault-1')

    const env = envelope()
    expect(env.data).toMatchObject({ switched: true, isActive: true })
    expect(env.data.vault).toMatchObject({ id: 'vault-1', name: 'Vultisig Cluster #1' })
  })
})

describe('rename', () => {
  it('emits an envelope carrying both the new and previous name', async () => {
    const vault = { ...vaultStub, rename: vi.fn(async () => {}) }
    const ctx = { ensureActiveVault: async () => vault } as unknown as CommandContext

    await executeRename(ctx, 'Renamed Vault')

    expect(envelope().data).toMatchObject({
      renamed: true,
      previousName: 'Vultisig Cluster #1',
      vault: { id: 'vault-1', name: 'Renamed Vault' },
    })
  })
})

describe('import', () => {
  it('emits an envelope identifying the imported vault', async () => {
    const vault = { ...vaultStub, on: vi.fn() }
    const ctx = {
      sdk: { importVault: vi.fn(async () => vault) },
      setActiveVault: vi.fn(async () => {}),
    } as unknown as CommandContext

    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-import-')), 'v.vult')
    await fs.writeFile(file, 'VULT-BYTES')

    await executeImport(ctx, file, 'pw')

    const env = envelope()
    expect(env.data).toMatchObject({ imported: true, isActive: true })
    expect(env.data.vault).toMatchObject({ id: 'vault-1', name: 'Vultisig Cluster #1' })
  })
})

describe('add-mldsa', () => {
  it('emits an envelope after mutating the vault file', async () => {
    // FastVault instance check: executeAddPostQuantumKeys refuses anything else.
    // id/name are prototype getters, so define them rather than assigning.
    const vault = Object.create(FastVault.prototype, {
      id: { value: vaultStub.id },
      name: { value: vaultStub.name },
    })
    const ctx = {
      ensureActiveVault: async () => vault,
      getPassword: vi.fn(async () => 'pw'),
      sdk: { addPostQuantumKeysToFastVault: vi.fn(async () => {}) },
    } as unknown as CommandContext

    await executeAddPostQuantumKeys(ctx, { email: 'e@x.io', password: 'pw' })

    expect(envelope().data).toMatchObject({ added: true, backupRecommended: true })
  })
})

describe('export', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vsig-export-envelope-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('emits an envelope naming the written path', async () => {
    const outputPath = path.join(tmpDir, 'out.vult')
    const ctx = {
      ensureActiveVault: async () => ({ export: vi.fn(async () => ({ data: 'BYTES', filename: 'v.vult' })) }),
    } as unknown as CommandContext

    await executeExport(ctx, { outputPath, exportPassword: 'pw' })

    expect(envelope().data).toMatchObject({ exported: true, path: outputPath, encrypted: true })
  })
})
