import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { knownCosmosTokens } from './cosmos'

// Pin the Osmosis IBC registry. Each hash was LCD-verified via
// osmosis-rest.publicnode.com and cross-referenced with cosmos/chain-registry.
// See spike gist: https://gist.github.com/gomesalexandre/c0f889c7c8b1f5fe698c08542cd2402a
describe('knownCosmosTokens[Chain.Osmosis]', () => {
  const osmosis = knownCosmosTokens[Chain.Osmosis]

  it('contains ATOM with the correct verified IBC hash', () => {
    const hash = 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2'
    expect(osmosis[hash]).toMatchObject({
      ticker: 'ATOM',
      decimals: 6,
      priceProviderId: 'cosmos',
    })
  })

  it('contains Noble USDC with the verified IBC hash (not the corrupted ...BA84 variant)', () => {
    // CRITICAL: the corrupted variant ibc/498A0751...BA84 (63-char hex, odd length)
    // must NOT appear. The correct hash ends in BA6E4 (64 chars).
    const correctHash = 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4'
    const corruptedHash = 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA84'

    expect(osmosis[correctHash]).toMatchObject({
      ticker: 'USDC',
      decimals: 6,
      priceProviderId: 'usd-coin',
    })
    expect(osmosis[corruptedHash]).toBeUndefined()
  })

  it('contains axlUSDC (Axelar-bridged USDC) with its own IBC hash', () => {
    const hash = 'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858'
    expect(osmosis[hash]).toMatchObject({
      ticker: 'axlUSDC',
      decimals: 6,
      priceProviderId: 'usd-coin',
    })
  })

  it('contains stATOM with the correct verified IBC hash', () => {
    const hash = 'ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901'
    expect(osmosis[hash]).toMatchObject({
      ticker: 'stATOM',
      decimals: 6,
      priceProviderId: 'stride-staked-atom',
    })
  })

  it('contains stOSMO with the correct verified IBC hash', () => {
    const hash = 'ibc/D176154B0C63D1F9C6DCFB4F70349EBF2E2B5A87A05902F57A6AE92B863E9AEC'
    expect(osmosis[hash]).toMatchObject({
      ticker: 'stOSMO',
      decimals: 6,
      priceProviderId: 'stride-staked-osmo',
    })
  })

  it('contains TIA with the correct verified IBC hash', () => {
    const hash = 'ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877'
    expect(osmosis[hash]).toMatchObject({
      ticker: 'TIA',
      decimals: 6,
      priceProviderId: 'celestia',
    })
  })

  it('retains pre-existing ION and LVN entries', () => {
    expect(osmosis['uion']).toMatchObject({ ticker: 'ION', decimals: 6 })
    expect(osmosis['factory/osmo1mlng7pz4pnyxtpq0akfwall37czyk9lukaucsrn30ameplhhshtqdvfm5c/ulvn']).toBeDefined()
  })

  it('all 6 new IBC hashes are exactly 68 characters (ibc/ prefix + 64 hex chars)', () => {
    const newHashes = [
      'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
      'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4',
      'ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858',
      'ibc/C140AFD542AE77BD7DCC83F13FDD8C5E5BB8C4929785E6EC2F4C636F98F17901',
      'ibc/D176154B0C63D1F9C6DCFB4F70349EBF2E2B5A87A05902F57A6AE92B863E9AEC',
      'ibc/D79E7D83AB399BFFF93433E54FAA480C191248FC556924A2A8351AE2638B3877',
    ]
    for (const hash of newHashes) {
      expect(hash.length, `${hash} should be 68 chars`).toBe(68)
      expect(hash.startsWith('ibc/'), `${hash} should start with ibc/`).toBe(true)
      expect(hash.slice(4).length, `${hash} hex part should be 64 chars`).toBe(64)
    }
  })
})
