import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, getUtxoChainSpec } from './tx'

// Compressed pubkey (arbitrary, unused for the pre-signing dust guard).
const COMPRESSED_PUBKEY = Uint8Array.from(
  '02'
    .concat('aa'.repeat(32))
    .match(/.{2}/g)!
    .map(b => parseInt(b, 16))
)

// Real BIP141 P2WPKH address for both from/to.
const BTC_P2WPKH = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

// UTXO-02 (audit r2): the sdk keeps its OWN per-chain dustLimit map (UTXO_SPECS) separate from core's
// minUtxo. Both must carry the corrected Litecoin P2WPKH dust — the shared standard 2_940n litoshi (LTC's
// DUST_RELAY_TX_FEE is ~10x BTC's), not the old 1_000n. This asserts the sdk map; the identical 2_940n
// literal is pinned on core's side by packages/core/chain/chains/utxo/minUtxo.test.ts, so the two can't
// silently drift below the standard. (A cross-package import here would resolve the BUILT core-chain, not
// the source, so each package asserts the shared constant independently.)
describe('getUtxoChainSpec — Litecoin dust threshold (UTXO-02)', () => {
  const LTC_P2WPKH_DUST = 2_940n // shared standard; keep === minUtxo[Chain.Litecoin] in core

  it('uses the P2WPKH standard 2_940n, not the old dangerous 1_000n', () => {
    expect(getUtxoChainSpec('Litecoin').dustLimit).toBe(LTC_P2WPKH_DUST)
    expect(getUtxoChainSpec('Litecoin').dustLimit).toBeGreaterThan(1_000n)
  })

  it('treats a 1_001..2_939 change output as DUST (change > dustLimit is false)', () => {
    const { dustLimit } = getUtxoChainSpec('Litecoin')
    for (const change of [1_001n, 2_000n, 2_939n]) expect(change > dustLimit).toBe(false)
    expect(2_941n > dustLimit).toBe(true)
  })

  it('leaves Bitcoin unchanged', () => {
    expect(getUtxoChainSpec('Bitcoin').dustLimit).toBe(546n)
  })
})

describe('buildUtxoSendTx — primary-amount dust floor (#1137)', () => {
  const baseOpts = {
    chain: 'Bitcoin' as const,
    fromAddress: BTC_P2WPKH,
    toAddress: BTC_P2WPKH,
    utxos: [
      {
        hash: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f',
        index: 0,
        value: 100_000n,
      },
    ],
    feeRate: 1,
    compressedPubKey: COMPRESSED_PUBKEY,
  }

  it('throws before signing when the send amount is below the dust limit', () => {
    // 545 < BTC 546n dust: the output would be unrelayable, so the ceremony
    // must never start.
    expect(() => buildUtxoSendTx({ ...baseOpts, amount: 545n })).toThrow(/below the Bitcoin dust limit 546/)
  })

  it('still throws on the existing zero/negative-amount guard', () => {
    expect(() => buildUtxoSendTx({ ...baseOpts, amount: 0n })).toThrow('amount must be greater than zero')
  })

  it('does not trip the dust guard for an at-limit amount', () => {
    expect(() => buildUtxoSendTx({ ...baseOpts, amount: 546n })).not.toThrow(/dust limit/)
  })
})
