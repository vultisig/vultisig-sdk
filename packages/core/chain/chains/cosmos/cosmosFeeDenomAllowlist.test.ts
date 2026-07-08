import { CosmosChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getCosmosAllowedFeeDenoms, isCosmosFeeDenomAllowed } from './cosmosFeeDenomAllowlist'

describe('getCosmosAllowedFeeDenoms', () => {
  it('is single-entry (native only) for chains with no live-verified alternate', () => {
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Cosmos)).toEqual(['uatom'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Kujira)).toEqual(['ukuji'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Terra)).toEqual(['uluna'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Akash)).toEqual(['uakt'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Dydx)).toEqual(['adydx'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.Noble)).toEqual(['uusdc'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.THORChain)).toEqual(['rune'])
    expect(getCosmosAllowedFeeDenoms(CosmosChain.MayaChain)).toEqual(['cacao'])
  })

  it('includes the uusd (USTC) alternate for TerraClassic alongside the native uluna', () => {
    expect(getCosmosAllowedFeeDenoms(CosmosChain.TerraClassic)).toEqual(['uluna', 'uusd'])
  })

  it('includes the curated IBC fee tokens for Osmosis alongside native uosmo (not the full 173+ on-chain txfees whitelist)', () => {
    const allowed = getCosmosAllowedFeeDenoms(CosmosChain.Osmosis)
    expect(allowed[0]).toBe('uosmo')
    expect(allowed).toHaveLength(4)
    expect(allowed).toContain(
      'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2' // ATOM
    )
    expect(allowed).toContain(
      'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4' // Noble USDC
    )
    expect(allowed).toContain(
      'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858' // axlUSDC
    )
  })
})

describe('isCosmosFeeDenomAllowed', () => {
  it('accepts the native denom on every chain', () => {
    expect(isCosmosFeeDenomAllowed(CosmosChain.Cosmos, 'uatom')).toBe(true)
    expect(isCosmosFeeDenomAllowed(CosmosChain.Osmosis, 'uosmo')).toBe(true)
  })

  it('accepts uusd on TerraClassic but rejects it on Terra v2 (shared uluna denom, different fee rules)', () => {
    expect(isCosmosFeeDenomAllowed(CosmosChain.TerraClassic, 'uusd')).toBe(true)
    expect(isCosmosFeeDenomAllowed(CosmosChain.Terra, 'uusd')).toBe(false)
  })

  it('accepts a whitelisted IBC fee token on Osmosis but rejects it on Cosmos Hub (same token, different chain)', () => {
    const atomIbcHash = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    expect(isCosmosFeeDenomAllowed(CosmosChain.Osmosis, atomIbcHash)).toBe(true)
    expect(isCosmosFeeDenomAllowed(CosmosChain.Cosmos, atomIbcHash)).toBe(false)
  })

  it('rejects an arbitrary unrecognized denom on every chain', () => {
    expect(isCosmosFeeDenomAllowed(CosmosChain.Cosmos, 'not-a-real-denom')).toBe(false)
    expect(isCosmosFeeDenomAllowed(CosmosChain.Osmosis, 'not-a-real-denom')).toBe(false)
  })
})
