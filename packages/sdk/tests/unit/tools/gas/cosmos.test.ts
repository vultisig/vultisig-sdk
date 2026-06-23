import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  COSMOS_SWAP_FEE_LABEL_CHAINS,
  COSMOS_SWAP_GAS_LIMIT,
  estimateCosmosSwapFeeLabel,
  getCosmosGasLimit,
  getCosmosSwapGasLimit,
} from '@/tools/gas'

describe('estimateCosmosSwapFeeLabel', () => {
  it('formats a cosmos swap fee label as "~<amount> <TICKER>"', () => {
    // 350_000 gas * 0.025 uatom/gas / 1e6 = 0.00875 ATOM → ~0.00875 ATOM
    expect(estimateCosmosSwapFeeLabel(Chain.Cosmos)).toBe('~0.00875 ATOM')
  })

  it('handles TerraClassic high gas price (28.325 uluna/gas)', () => {
    // 350_000 * 28.325 / 1e6 = 9.91375 LUNC → 3 sig figs → ~9.91 LUNC
    expect(estimateCosmosSwapFeeLabel(Chain.TerraClassic)).toBe('~9.91 LUNC')
  })

  it('uses OSMO ticker + decimals for Osmosis', () => {
    // 350_000 * 0.0025 / 1e6 = 0.000875 OSMO
    expect(estimateCosmosSwapFeeLabel(Chain.Osmosis)).toBe('~0.000875 OSMO')
  })

  it('returns "" for flat-fee cosmos chains (THORChain has no gas market)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.THORChain)).toBe('')
    expect(estimateCosmosSwapFeeLabel(Chain.MayaChain)).toBe('')
  })

  it('returns "" for non-cosmos / unknown chains', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Ethereum)).toBe('')
    expect(estimateCosmosSwapFeeLabel('Bitcoin')).toBe('')
    expect(estimateCosmosSwapFeeLabel('NotAChain')).toBe('')
  })

  it('honours a gasLimit override', () => {
    // 700_000 * 0.025 / 1e6 = 0.0175 ATOM
    expect(estimateCosmosSwapFeeLabel(Chain.Cosmos, { gasLimit: 700_000n })).toBe('~0.0175 ATOM')
  })

  it('lists exactly the gas-market chains as label-eligible', () => {
    expect([...COSMOS_SWAP_FEE_LABEL_CHAINS].sort()).toEqual(
      [Chain.Cosmos, Chain.Kujira, Chain.Osmosis, Chain.Terra, Chain.TerraClassic].sort()
    )
  })
})

describe('getCosmosSwapGasLimit', () => {
  it('returns the heuristic source-leg gas limit', () => {
    expect(getCosmosSwapGasLimit(Chain.Cosmos)).toBe(COSMOS_SWAP_GAS_LIMIT)
    expect(getCosmosSwapGasLimit(Chain.Osmosis)).toBe(350_000n)
  })
})

describe('getCosmosGasLimit (re-export from core-chain)', () => {
  it('returns the per-coin native gas limit', () => {
    expect(getCosmosGasLimit({ chain: Chain.Cosmos, id: 'uatom' })).toBe(200_000n)
    expect(getCosmosGasLimit({ chain: Chain.Osmosis, id: 'uosmo' })).toBe(300_000n)
  })

  it('applies the TerraClassic uusd burn-tax override (1M)', () => {
    expect(getCosmosGasLimit({ chain: Chain.TerraClassic, id: 'uusd' })).toBe(1_000_000n)
    expect(getCosmosGasLimit({ chain: Chain.TerraClassic, id: 'uluna' })).toBe(400_000n)
  })
})
