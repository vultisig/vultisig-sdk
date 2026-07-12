/**
 * UTXO-03 (audit r2): `buildUtxoSendTx` only enforced a fee floor for Zcash;
 * every other UTXO chain trusted the caller-supplied `feeRate` with no
 * chain-aware minimum. Dogecoin's block-inclusion min-fee (1000 koinu/vB, dogecoin/dogecoin's
 * DEFAULT_BLOCK_MIN_TX_FEE=RECOMMENDED_MIN_TX_FEE=COIN/100; the lower DEFAULT_MIN_RELAY_TX_FEE of 100 only
 * relays, may not mine) is ~1000x Bitcoin's (1
 * sat/vB), so a BTC-reasonable rate silently underpays DOGE below relay and
 * the tx gets stuck/non-relayable.
 *
 * The builder doesn't expose the computed fee directly, so — same technique
 * as utxo-zcash-zip317-fee.test.ts — the floor is observed via the
 * insufficient-funds error, which reports the exact fee charged.
 */
import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx, type UtxoChainName } from '../../../src/chains/utxo'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.match(/.{2}/g)!.map(b => parseInt(b, 16))
)

// Dash P2PKH (version 0x4c) has no well-known canonical test address in this
// repo — synthesize one the same way utxo-p2sh.test.ts does, independent of
// address-format trivia.
const dashP2pkhAddress = (): string => {
  const hash20 = Uint8Array.from('0102030405060708090a0b0c0d0e0f1011121314'.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  const payload = new Uint8Array(21)
  payload[0] = 0x4c
  payload.set(hash20, 1)
  return bs58check.encode(payload)
}

const ADDRESS_BY_CHAIN: Record<Exclude<UtxoChainName, 'Zcash'>, string> = {
  Bitcoin: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
  Litecoin: 'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9',
  Dogecoin: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
  'Bitcoin-Cash': 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
  Dash: dashP2pkhAddress(),
}

const build = ({
  chain,
  utxoValue,
  amount,
  feeRate,
}: {
  chain: Exclude<UtxoChainName, 'Zcash'>
  utxoValue: bigint
  amount: bigint
  feeRate: number
}) =>
  buildUtxoSendTx({
    chain,
    fromAddress: ADDRESS_BY_CHAIN[chain],
    toAddress: ADDRESS_BY_CHAIN[chain],
    amount,
    utxos: [{ hash: 'ff'.repeat(32), index: 0, value: utxoValue }],
    feeRate,
    compressedPubKey: COMPRESSED_PUBKEY,
  })

describe('UTXO-03 — per-chain minimum relay fee floor', () => {
  describe('Dogecoin (1000 koinu/vB floor — DEFAULT_BLOCK_MIN_TX_FEE, ensures mining not just relay)', () => {
    // txSize for a single p2pkh input, no memo: 1*150 + 2*34 + 10 = 228 bytes.
    const amount = 100_000_000n

    it('raises a BTC-reasonable 1 koinu/vB rate to the 1000 koinu/vB floor (fee=228000, not 228)', () => {
      // Floor is the miner block-INCLUSION min (1000), not the lower relay-min (100): a 100-floor tx would
      // relay but could sit unmined. At the buggy pre-fix behaviour the fee would be 228*1=228; funds here
      // cover the FLOORED fee minus one, so the error's reported fee proves which value was actually charged.
      expect(() => build({ chain: 'Dogecoin', utxoValue: amount + 227_999n, amount, feeRate: 1 })).toThrowError(
        /fee=228000\b/
      )
      expect(() => build({ chain: 'Dogecoin', utxoValue: amount + 228_000n, amount, feeRate: 1 })).not.toThrowError()
    })

    it('does not raise a feeRate already at or above the floor (no overpaying a legit rate)', () => {
      // 2000 koinu/vB > the 1000 floor -> sizeFee 228*2000=456000 passes through unchanged.
      expect(() => build({ chain: 'Dogecoin', utxoValue: amount + 455_999n, amount, feeRate: 2000 })).toThrowError(
        /fee=456000\b/
      )
      expect(() => build({ chain: 'Dogecoin', utxoValue: amount + 456_000n, amount, feeRate: 2000 })).not.toThrowError()
    })
  })

  describe('Bitcoin / Litecoin / Bitcoin-Cash / Dash (1 sat-equivalent/vB floor)', () => {
    const amount = 10_000n
    // txSize: Bitcoin/Litecoin p2wpkh single input = 68 + 68 + 10 = 146 bytes.
    // Bitcoin-Cash/Dash p2pkh single input = 150 + 68 + 10 = 228 bytes.
    const txSizeFor = (chain: Exclude<UtxoChainName, 'Zcash' | 'Dogecoin'>) =>
      chain === 'Bitcoin' || chain === 'Litecoin' ? 146 : 228

    for (const chain of ['Bitcoin', 'Litecoin', 'Bitcoin-Cash', 'Dash'] as const) {
      it(`${chain}: a sub-1 feeRate is raised to the 1/vB floor`, () => {
        const floored = txSizeFor(chain) * 1
        expect(() => build({ chain, utxoValue: amount + BigInt(floored) - 1n, amount, feeRate: 0.5 })).toThrowError(
          new RegExp(`fee=${floored}\\b`)
        )
        expect(() => build({ chain, utxoValue: amount + BigInt(floored), amount, feeRate: 0.5 })).not.toThrowError()
      })

      it(`${chain}: a normal above-floor feeRate passes through unchanged (no overpay)`, () => {
        const expected = txSizeFor(chain) * 5
        expect(() => build({ chain, utxoValue: amount + BigInt(expected) - 1n, amount, feeRate: 5 })).toThrowError(
          new RegExp(`fee=${expected}\\b`)
        )
        expect(() => build({ chain, utxoValue: amount + BigInt(expected), amount, feeRate: 5 })).not.toThrowError()
      })
    }
  })
})
