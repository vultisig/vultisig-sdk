import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'

import { kaminoMaxDecimals } from './baseUnits'
import { kaminoConfig } from './config'
import { getKaminoVaultDescriptor, kaminoVaultRegistry } from './registry'

describe('kaminoVaultRegistry', () => {
  it('carries the three launch vaults', () => {
    expect(kaminoVaultRegistry.map(vault => vault.fallbackName)).toEqual(['Steakhouse USDC', 'RWA USDC', 'Allez SOL'])
  })

  it('pins only valid Solana addresses — a typo here is a money-critical constant', () => {
    const addresses = kaminoVaultRegistry.flatMap(vault => [
      vault.address,
      vault.tokenMint,
      vault.sharesMint,
      ...(vault.farm ? [vault.farm] : []),
    ])
    for (const address of [...addresses, kaminoConfig.programId, kaminoConfig.farmsProgramId]) {
      expect(() => new PublicKey(address), address).not.toThrow()
    }
  })

  it('pins decimal scales inside the plausible range', () => {
    for (const vault of kaminoVaultRegistry) {
      expect(vault.tokenDecimals).toBeGreaterThanOrEqual(0)
      expect(vault.tokenDecimals).toBeLessThanOrEqual(kaminoMaxDecimals)
      expect(vault.sharesDecimals).toBeGreaterThanOrEqual(0)
      expect(vault.sharesDecimals).toBeLessThanOrEqual(kaminoMaxDecimals)
    }
  })

  it('pins the known scales, including the vault whose two scales differ', () => {
    const byName = Object.fromEntries(kaminoVaultRegistry.map(vault => [vault.fallbackName, vault]))
    expect(byName['Steakhouse USDC']).toMatchObject({ tokenDecimals: 6, sharesDecimals: 6 })
    expect(byName['RWA USDC']).toMatchObject({ tokenDecimals: 6, sharesDecimals: 6 })
    // Nothing may assume the two scales match: this is the (9, 6) vault.
    expect(byName['Allez SOL']).toMatchObject({
      tokenDecimals: 9,
      sharesDecimals: 6,
      tokenMint: kaminoConfig.wrappedSolMint,
    })
  })

  it('has no duplicate vault addresses', () => {
    const addresses = kaminoVaultRegistry.map(vault => vault.address)
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it('every vault carries a farm — deposits auto-stake and shares never reach the wallet', () => {
    for (const vault of kaminoVaultRegistry) {
      expect(vault.farm).toBeDefined()
    }
  })
})

describe('getKaminoVaultDescriptor', () => {
  it('resolves a curated address and refuses anything else', () => {
    expect(getKaminoVaultDescriptor('HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E')?.curator).toBe(
      'Steakhouse Financial'
    )
    expect(getKaminoVaultDescriptor('So11111111111111111111111111111111111111112')).toBeUndefined()
    expect(getKaminoVaultDescriptor('')).toBeUndefined()
  })
})
