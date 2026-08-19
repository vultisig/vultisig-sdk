import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, getUtxoChainSpec } from './tx'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02'
    .concat('aa'.repeat(32))
    .match(/.{2}/g)!
    .map(b => parseInt(b, 16))
)

const BTC_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

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

  it('rejects primary send outputs at or below the chain dust threshold', () => {
    expect(() =>
      buildUtxoSendTx({
        chain: 'Bitcoin',
        fromAddress: BTC_ADDRESS,
        toAddress: BTC_ADDRESS,
        amount: getUtxoChainSpec('Bitcoin').dustLimit,
        utxos: [{ hash: '11'.repeat(32), index: 0, value: 100_000n }],
        feeRate: 1,
        compressedPubKey: COMPRESSED_PUBKEY,
      })
    ).toThrow('amount is dust for Bitcoin: amount=546 dustLimit=546')
  })
})
