import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import { minUtxo } from './minUtxo'

// UTXO-02 (audit r2): Litecoin's dust threshold was hardcoded 1_000n — ~3x below the real P2WPKH standard
// (~2_940 litoshi; LTC's DUST_RELAY_TX_FEE is ~10x Bitcoin's). A change output of 1_001..2_939 was treated
// as spendable but is non-standard dust -> the tx can be rejected by relays / stall. This pins the corrected
// value + the dust-boundary semantics used by the change-output guard (`change > dustLimit`).
describe('minUtxo — Litecoin dust threshold (UTXO-02)', () => {
  const ltcDust = minUtxo[Chain.Litecoin]

  it('is the P2WPKH standard ~2_940 litoshi, NOT the old dangerous 1_000n', () => {
    expect(ltcDust).toBe(2_940n)
    expect(ltcDust).toBeGreaterThan(1_000n) // the pre-fix value that under-counted dust
  })

  it('treats a 1_001..2_939 change output as DUST (change > dustLimit is false)', () => {
    // these were spendable at the old 1_000n limit; now correctly below the standard dust floor
    for (const change of [1_001n, 2_000n, 2_939n]) {
      expect(change > ltcDust).toBe(false)
    }
  })

  it('treats a change output strictly above the threshold as spendable', () => {
    expect(2_941n > ltcDust).toBe(true)
    expect(2_940n > ltcDust).toBe(false) // exactly at the limit is not "> limit" -> absorbed to fee, safe
  })

  it('leaves the other UTXO chains unchanged (LTC-scoped fix)', () => {
    expect(minUtxo[Chain.Bitcoin]).toBe(546n)
    expect(minUtxo[Chain.Dogecoin]).toBe(1_000_000n)
    // BCH/Dash/Zcash 1_000n is already >= their ~546 BTC-like dust (conservative, not dangerous) — left as-is.
    expect(minUtxo[Chain.BitcoinCash]).toBe(1_000n)
    expect(minUtxo[Chain.Dash]).toBe(1_000n)
    expect(minUtxo[Chain.Zcash]).toBe(1_000n)
  })
})
