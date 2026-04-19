import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { discoverVaultFiles, SEARCH_DIRS } from '../../src/core/vault-discovery'

describe('vault-discovery', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-discovery-test-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('SEARCH_DIRS includes expected paths', () => {
    const home = os.homedir()
    expect(SEARCH_DIRS).toContain(path.join(home, '.vultisig'))
    expect(SEARCH_DIRS).toContain(path.join(home, 'Documents', 'Vultisig'))
    expect(SEARCH_DIRS).toHaveLength(2)
  })

  it('discovers .vult files in extra dirs', async () => {
    const vaultFile = path.join(tmpDir, 'test.vult')
    await fs.writeFile(vaultFile, 'test-content')

    const found = await discoverVaultFiles([tmpDir])
    expect(found).toContain(vaultFile)
  })

  it('ignores non-.vult files', async () => {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'not a vault')
    await fs.writeFile(path.join(tmpDir, 'real.vult'), 'vault data')

    const found = await discoverVaultFiles([tmpDir])
    const inTmp = found.filter(f => f.startsWith(tmpDir))
    expect(inTmp).toHaveLength(1)
    expect(inTmp[0]).toContain('real.vult')
  })

  it('discovers .vult files in subdirectories up to depth 2', async () => {
    const subDir = path.join(tmpDir, 'level1', 'level2')
    await fs.mkdir(subDir, { recursive: true })
    await fs.writeFile(path.join(subDir, 'deep.vult'), 'vault data')

    const found = await discoverVaultFiles([tmpDir])
    const inTmp = found.filter(f => f.startsWith(tmpDir))
    expect(inTmp).toHaveLength(1)
    expect(inTmp[0]).toContain('deep.vult')
  })

  it('does not discover files beyond max depth 2', async () => {
    const deepDir = path.join(tmpDir, 'a', 'b', 'c')
    await fs.mkdir(deepDir, { recursive: true })
    await fs.writeFile(path.join(deepDir, 'too-deep.vult'), 'vault data')

    const found = await discoverVaultFiles([tmpDir])
    const inTmp = found.filter(f => f.startsWith(tmpDir))
    expect(inTmp).toHaveLength(0)
  })

  it('deduplicates results', async () => {
    const vaultFile = path.join(tmpDir, 'dup.vult')
    await fs.writeFile(vaultFile, 'vault data')

    // Pass the same dir twice as extra dirs
    const found = await discoverVaultFiles([tmpDir, tmpDir])
    const matches = found.filter(f => f === vaultFile)
    expect(matches).toHaveLength(1)
  })

  it('handles non-existent directories gracefully', async () => {
    const found = await discoverVaultFiles(['/nonexistent/path/abc123'])
    // Should not throw, just return whatever it finds from other dirs
    expect(Array.isArray(found)).toBe(true)
  })
})
