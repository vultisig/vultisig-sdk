import { describe, expect, it } from 'vitest'

import { CosmosChain } from '../../Chain'
import { getCosmosChainId } from './chainInfo'
import { COSMOS_CHAIN_ID_HRP, getCosmosChainHrp } from './cosmosHrp'

// architecture#1787 — this registry consolidates four independently-maintained,
// overlapping tables (SDK gov.ts's CHAIN_HRP, ibcTransfer.ts's IBC_CHAIN_HRP,
// skipSwap.ts's COSMOS_CHAIN_HRPS, resolveContract.ts's CW20_CHAIN_PREFIX).
// These tests pin the exact literal values each of those four ORIGINALLY
// declared, so a future edit here can't silently drift one of the four
// modules that now derive from it.

describe('getCosmosChainHrp', () => {
  // Every CosmosChain must resolve — a registry gap here is a bug in this
  // file, not a caller error (see the function's own fail-loud contract).
  it('resolves an HRP for every CosmosChain member', () => {
    for (const chain of Object.values(CosmosChain)) {
      expect(() => getCosmosChainHrp(chain)).not.toThrow()
    }
  })

  // Pinned from the original tools/cosmos/gov.ts CHAIN_HRP literal.
  it('matches gov.ts pre-consolidation values', () => {
    expect(getCosmosChainHrp(CosmosChain.Cosmos)).toBe('cosmos')
    expect(getCosmosChainHrp(CosmosChain.Osmosis)).toBe('osmo')
    expect(getCosmosChainHrp(CosmosChain.Dydx)).toBe('dydx')
    expect(getCosmosChainHrp(CosmosChain.Kujira)).toBe('kujira')
    expect(getCosmosChainHrp(CosmosChain.Terra)).toBe('terra')
    expect(getCosmosChainHrp(CosmosChain.TerraClassic)).toBe('terra')
    expect(getCosmosChainHrp(CosmosChain.Noble)).toBe('noble')
    expect(getCosmosChainHrp(CosmosChain.Akash)).toBe('akash')
  })

  // Pinned from the original tools/token/resolveContract.ts CW20_CHAIN_PREFIX
  // literal (a subset of gov's set, same values).
  it('matches resolveContract.ts pre-consolidation CW20 values', () => {
    expect(getCosmosChainHrp(CosmosChain.TerraClassic)).toBe('terra')
    expect(getCosmosChainHrp(CosmosChain.Terra)).toBe('terra')
    expect(getCosmosChainHrp(CosmosChain.Osmosis)).toBe('osmo')
    expect(getCosmosChainHrp(CosmosChain.Kujira)).toBe('kujira')
  })

  // THORChain/MayaChain are vault-based (not IBC-enabled), so gov.ts/CW20
  // never covered them — but skipSwap.ts's COSMOS_CHAIN_HRPS did.
  it('resolves the two vault-based chains too (previously only in skipSwap.ts)', () => {
    expect(getCosmosChainHrp(CosmosChain.THORChain)).toBe('thor')
    expect(getCosmosChainHrp(CosmosChain.MayaChain)).toBe('maya')
  })

})

describe('COSMOS_CHAIN_ID_HRP', () => {
  // Pinned from the original tools/prep/ibcTransfer.ts IBC_CHAIN_HRP literal
  // (the superset — includes IBC destination chains with no CosmosChain
  // member of their own).
  it('matches ibcTransfer.ts pre-consolidation values, including chain-ids outside CosmosChain', () => {
    expect(COSMOS_CHAIN_ID_HRP['phoenix-1']).toBe('terra')
    expect(COSMOS_CHAIN_ID_HRP['columbus-5']).toBe('terra')
    expect(COSMOS_CHAIN_ID_HRP['cosmoshub-4']).toBe('cosmos')
    expect(COSMOS_CHAIN_ID_HRP['osmosis-1']).toBe('osmo')
    expect(COSMOS_CHAIN_ID_HRP['kaiyo-1']).toBe('kujira')
    expect(COSMOS_CHAIN_ID_HRP['neutron-1']).toBe('neutron')
    expect(COSMOS_CHAIN_ID_HRP['axelar-dojo-1']).toBe('axelar')
    expect(COSMOS_CHAIN_ID_HRP['injective-1']).toBe('inj')
    expect(COSMOS_CHAIN_ID_HRP['juno-1']).toBe('juno')
    expect(COSMOS_CHAIN_ID_HRP['stargaze-1']).toBe('stars')
    expect(COSMOS_CHAIN_ID_HRP['noble-1']).toBe('noble')
    expect(COSMOS_CHAIN_ID_HRP['akashnet-2']).toBe('akash')
    expect(COSMOS_CHAIN_ID_HRP['dydx-mainnet-1']).toBe('dydx')
    expect(COSMOS_CHAIN_ID_HRP['stride-1']).toBe('stride')
    expect(COSMOS_CHAIN_ID_HRP.celestia).toBe('celestia')
  })

  // Pinned from the original tools/swap/skip/skipSwap.ts COSMOS_CHAIN_HRPS
  // literal (the entries IBC's table didn't have).
  it('matches skipSwap.ts pre-consolidation values not covered by ibcTransfer.ts', () => {
    expect(COSMOS_CHAIN_ID_HRP['thorchain-1']).toBe('thor')
    expect(COSMOS_CHAIN_ID_HRP['mayachain-mainnet-v1']).toBe('maya')
    expect(COSMOS_CHAIN_ID_HRP['agoric-3']).toBe('agoric')
  })

  // Every CosmosChain's chain-id must have an entry — getCosmosChainHrp
  // depends on this for every first-class chain.
  it('covers the chain-id for every CosmosChain', () => {
    for (const chain of Object.values(CosmosChain)) {
      expect(COSMOS_CHAIN_ID_HRP[getCosmosChainId(chain)]).toBeDefined()
    }
  })
})
