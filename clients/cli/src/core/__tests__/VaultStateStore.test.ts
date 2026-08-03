import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { VaultStateStore } from '../VaultStateStore'

describe('VaultStateStore config-dir wiring', () => {
  const originalConfigDir = process.env.VULTISIG_CONFIG_DIR
  let tmpConfigDir: string

  beforeEach(() => {
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'vultisig-state-'))
    process.env.VULTISIG_CONFIG_DIR = tmpConfigDir
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.VULTISIG_CONFIG_DIR
    } else {
      process.env.VULTISIG_CONFIG_DIR = originalConfigDir
    }
    rmSync(tmpConfigDir, { recursive: true, force: true })
  })

  it('stores vault state under VULTISIG_CONFIG_DIR', () => {
    const store = new VaultStateStore('vault-123')

    store.recordEvmNonce('Ethereum', 7n)

    const expectedStatePath = join(tmpConfigDir, 'vault-state', 'vault123', 'Ethereum.state.json')
    expect(existsSync(expectedStatePath)).toBe(true)
    expect(store.getNextEvmNonce('Ethereum', 0n)).toBe(8n)
  })

  it('falls back to the on-chain nonce after the local state ages out', () => {
    const store = new VaultStateStore('vault-123')

    store.recordEvmNonce('Ethereum', 7n)

    expect(store.getNextEvmNonce('Ethereum', 9n)).toBe(9n)
  })
})
