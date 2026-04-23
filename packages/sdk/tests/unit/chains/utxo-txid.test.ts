/**
 * Regression test for BIP141 txid computation.
 *
 * P2WPKH (native segwit) tx broadcast bytes look like:
 *   version || marker(0x00) || flag(0x01) || inputs || outputs || witness || locktime
 *
 * The **txid** is NOT hash(broadcastBytes). That produces the **wtxid**, which
 * is a different thing entirely — block explorers and mempool APIs key on
 * txid, so handing a wtxid to a caller who expects a txid leads to their
 * "tx not found" lookups on every segwit tx we build.
 *
 * BIP141 spec: txid = dSHA256(version || inputs || outputs || locktime) —
 * the "base" serialization with marker+flag+witness stripped.
 */
import { describe, expect, it } from 'vitest'

import { buildUtxoSendTx } from '../../../src/chains/utxo/tx'

// Compressed pubkey for the throwaway hash-target below (arbitrary, doesn't
// need to match the signatures — we only want the assembled raw bytes).
const COMPRESSED_PUBKEY = Uint8Array.from(
  '02'
    .repeat(1)
    .concat('aa'.repeat(32))
    .match(/.{2}/g)!
    .map(b => parseInt(b, 16))
)

// Deterministic sig bytes — 64 chars r + 64 chars s + 2 chars v. DER encoding
// is a function of r,s only, so these just need to be distinct from 0 and
// low enough for the low-S normaliser.
const DUMMY_SIG =
  '1111111111111111111111111111111111111111111111111111111111111111' +
  '2222222222222222222222222222222222222222222222222222222222222222' +
  '00'

describe('buildUtxoSendTx / finalize — BIP141 txid', () => {
  it('BTC (P2WPKH): txid is computed from the witness-stripped base tx, not the broadcastable segwit bytes', async () => {
    const builder = buildUtxoSendTx({
      chain: 'Bitcoin',
      fromAddress: 'bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej',
      toAddress: 'bc1qwqdg6squsna38e46795at95yu9atm8azzmyvckulcc7kytlcckxswvvzej',
      amount: 10_000n,
      utxos: [
        {
          hash: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f',
          index: 0,
          value: 100_000n,
        },
      ],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    })

    const { rawTxHex, txHashHex } = builder.finalize([DUMMY_SIG])

    // Cross-check against bitcoinjs-lib: parse our rawTx, get its txid,
    // and assert our txHashHex matches bitcoinjs's .getId() (which uses
    // the BIP141 base-tx hash under the hood).
    const bjs = await import('bitcoinjs-lib')
    const tx = bjs.Transaction.fromHex(rawTxHex)
    const bjsTxid = tx.getId()
    const bjsWtxid = Buffer.from(tx.getHash(true)).reverse().toString('hex')

    // P2WPKH txs have witness data — txid and wtxid must differ. If they
    // don't, the tx isn't actually segwit and this test vector is wrong.
    expect(bjsTxid).not.toBe(bjsWtxid)

    // The actual regression assertion: our txHashHex matches the reference
    // txid, NOT the wtxid. The original bug hashed the full broadcast bytes
    // (including marker+flag+witness), which yields the wtxid and would
    // fail this assertion.
    expect(txHashHex).toBe(bjsTxid)
    expect(txHashHex).not.toBe(bjsWtxid)
  })

  it('DOGE (P2PKH): txid still hashes the full (witness-less) broadcast bytes — no regression for legacy chains', async () => {
    const builder = buildUtxoSendTx({
      chain: 'Dogecoin',
      fromAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
      toAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
      amount: 100_000_000n,
      utxos: [
        {
          hash: 'fff7f7881a8099afa6940d42d1e7f6362bec38171ea3edf433541db4e4ad969f',
          index: 0,
          value: 200_000_000n,
        },
      ],
      feeRate: 1,
      compressedPubKey: COMPRESSED_PUBKEY,
    })

    const { rawTxHex, txHashHex } = builder.finalize([DUMMY_SIG])
    const bjs = await import('bitcoinjs-lib')
    // P2PKH DOGE txs are bitcoin-compatible at the wire-format level (same
    // version/inputs/outputs/locktime encoding). Reuse bitcoinjs here as an
    // oracle — the only wire difference is Dogecoin uses version=1 legacy txs.
    const tx = bjs.Transaction.fromHex(rawTxHex)
    expect(txHashHex).toBe(tx.getId())
  })
})
