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
  // The label is the SAME canonical base-unit fee the SDK signer charges
  // (`cosmosGasRecord`), formatted with `chainFeeCoin` ticker/decimals. These
  // assertions pin the exact value so a regression that under-displays the fee
  // (e.g. the old gas_limit×gas_price heuristic showed ~9.91 LUNC for a 100 LUNC
  // fee — a ~10x under-display) fails here.
  it('formats the canonical Cosmos swap fee (7500 uatom = 0.0075 ATOM)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Cosmos)).toBe('~0.0075 ATOM')
  })

  it('formats the canonical Osmosis swap fee (9000 uosmo = 0.009 OSMO)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Osmosis)).toBe('~0.009 OSMO')
  })

  // TerraClassic carries the 100 LUNC sign-time fee. This is the highest-blast
  // assertion: under-displaying it would badly mislead the user.
  it('formats the canonical TerraClassic swap fee (100_000_000 uluna = 100 LUNC)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.TerraClassic)).toBe('~100 LUNC')
  })

  // Terra (phoenix-1, LUNA) must not be confused with TerraClassic (columbus-5,
  // LUNC) — same base "LUNA" word, different ticker + fee.
  it('formats the canonical Terra swap fee (7500 uluna = 0.0075 LUNA, not LUNC)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Terra)).toBe('~0.0075 LUNA')
  })

  // Kujira's chainFeeCoin ticker is spread from the kujira-merge THOR metadata
  // (not a literal): a refactor that drops/renames KUJI silently breaks this.
  it('resolves KUJI ticker via the kujira-merge canonical metadata (7500 ukuji = 0.0075 KUJI)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Kujira)).toBe('~0.0075 KUJI')
  })

  // Noble / Akash / Dydx are Skip-routable cosmos sources the canonical mcp-ts
  // label also covers — dropping them would regress migrating consumers to ''.
  it('covers the remaining Skip-routable cosmos sources (Noble/Akash/Dydx)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Noble)).toBe('~0.03 USDC')
    expect(estimateCosmosSwapFeeLabel(Chain.Akash)).toBe('~0.2 AKT')
    expect(estimateCosmosSwapFeeLabel(Chain.Dydx)).toBe('~0.0025 DYDX')
  })

  it('returns "" for flat-fee cosmos chains (THORChain/MayaChain have no gas market)', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.THORChain)).toBe('')
    expect(estimateCosmosSwapFeeLabel(Chain.MayaChain)).toBe('')
  })

  it('returns "" for non-cosmos / unknown chains', () => {
    expect(estimateCosmosSwapFeeLabel(Chain.Ethereum)).toBe('')
    expect(estimateCosmosSwapFeeLabel('Bitcoin')).toBe('')
    expect(estimateCosmosSwapFeeLabel('NotAChain')).toBe('')
  })

  // Dydx fee is 2.5e15 adydx at 18 decimals — assert no exponential-notation leak
  // (a Number-based formatter would render "~2.5e-3 DYDX").
  it('never emits exponential notation for tiny-decimal fees', () => {
    const label = estimateCosmosSwapFeeLabel(Chain.Dydx)
    expect(label).not.toMatch(/e[+-]?\d/i)
    expect(label).toBe('~0.0025 DYDX')
  })

  it('lists exactly the canonical-fee cosmos chains as label-eligible', () => {
    expect([...COSMOS_SWAP_FEE_LABEL_CHAINS].sort()).toEqual(
      [
        Chain.Akash,
        Chain.Cosmos,
        Chain.Dydx,
        Chain.Kujira,
        Chain.Noble,
        Chain.Osmosis,
        Chain.Terra,
        Chain.TerraClassic,
      ].sort()
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
