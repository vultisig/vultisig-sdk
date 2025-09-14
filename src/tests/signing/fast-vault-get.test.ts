import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { Vultisig } from '../../VultisigSDK'
import { FastVaultClient } from '../../server/FastVaultClient'

// Real server integration test
describe('FastVault server GET /get/{vaultId}', () => {
  it('returns vault metadata for known test vault', async () => {
    vi.setConfig({ testTimeout: 30000 })

    const vaultPath = join(__dirname, '..', 'vaults', "TestFastVault-44fd-share2of2-Password123!.vult")
    const password = 'Password123!'

    // Load vault to obtain the ECDSA public key (vault id)
    const buffer = readFileSync(vaultPath)
    const file = new File([buffer], 'TestFastVault.vult', { type: 'application/octet-stream' })
    ;(file as any).buffer = buffer

    const sdk = new Vultisig()
    const vault = await sdk.addVault(file, password)

    // Prefer summary().keys.ecdsa, fallback to internal data
    const summary = vault.summary?.()
    const vaultId = summary?.keys?.ecdsa || (vault as any).vaultData?.publicKeys?.ecdsa
    expect(typeof vaultId).toBe('string')

    const client = new FastVaultClient('https://api.vultisig.com/vault')

    let data: any
    try {
      data = await client.getVault(vaultId, password)
    } catch (error: any) {
      // Provide clearer error for debugging real server failures
      throw new Error(`FastVault GET failed: ${error?.message || String(error)}`)
    }

    expect(data).toBeDefined()
    // Accept either field name depending on server response shape
    const returnedPk = data?.public_key_ecdsa || data?.public_key || data?.vault?.public_key_ecdsa
    expect(returnedPk).toBe(vaultId)
  })
})


