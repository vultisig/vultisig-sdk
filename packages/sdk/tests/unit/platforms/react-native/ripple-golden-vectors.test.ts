/**
 * XRP Ledger (Ripple) transaction golden-vector byte tests.
 *
 * Gap this fills: `buildXrpSendTx` (platforms/react-native/chains/ripple/tx.ts)
 * imports `ripple-binary-codec` directly for serialization (by design — the
 * `xrpl` barrel pulls in `Client`/`ws` which Hermes can't load), but no test
 * independently re-derives the Payment tx JSON and cross-checks the
 * serialized bytes against the `xrpl` package's own exported encoders.
 *
 * `xrpl`'s `encode`/`encodeForSigning` ARE the officially Ripple-maintained
 * reference serializer for the XRPL wire format (definitions.json-driven
 * field encoding) — the same underlying codec our SDK depends on directly,
 * just accessed via the full `xrpl` package instead of the trimmed
 * `ripple-binary-codec` import. The point of this test is NOT to catch a bug
 * in the codec itself (there's only one implementation in the JS ecosystem),
 * but to catch a bug in the SDK's OWN field-construction logic in
 * `buildXrpSendTx` (wrong field name/casing, wrong hex encoding for memos,
 * dropped DestinationTag, etc.) by re-deriving the same Payment JSON
 * independently from the raw inputs and asserting byte-for-byte equality.
 */
import { describe, expect, it } from 'vitest'
import { encode as xrplEncode, encodeForSigning as xrplEncodeForSigning, type Payment } from 'xrpl'

import { buildXrpSendTx } from '../../../../src/platforms/react-native/chains/ripple/tx'

const FX = {
  account: 'rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH',
  destination: 'rf1BiGeXwwQoi8Z2ueFYTEXSwuJYfV2Jpn',
  amount: '25000000', // drops
  fee: '12',
  sequence: 42,
  lastLedgerSequence: 12345,
  signingPubKey: '0286E56770CE9B95253CCB48D22DCE4EAE1CA3606A9DA6D4CDA3AA5C6D0A9DBEE',
}

function encodeDerInteger(hex: string): Buffer {
  let bytes = Buffer.from(hex, 'hex')
  while (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) === 0) {
    bytes = bytes.subarray(1)
  }
  if ((bytes[0] & 0x80) !== 0) {
    bytes = Buffer.concat([Buffer.from([0x00]), bytes])
  }
  return Buffer.concat([Buffer.from([0x02, bytes.length]), bytes])
}

function buildReferenceDerSignature(rHex: string, sHex: string): Buffer {
  const rDer = encodeDerInteger(rHex)
  const sDer = encodeDerInteger(sHex)
  return Buffer.concat([Buffer.from([0x30, rDer.length + sDer.length]), rDer, sDer])
}

describe('Ripple / buildXrpSendTx golden vectors', () => {
  it('matches an independently-built Payment tx serialized via xrpl.encodeForSigning', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
    })

    const referenceTx: Payment = {
      TransactionType: 'Payment',
      Account: FX.account,
      Destination: FX.destination,
      Amount: FX.amount,
      Fee: FX.fee,
      Sequence: FX.sequence,
      LastLedgerSequence: FX.lastLedgerSequence,
      SigningPubKey: FX.signingPubKey.toUpperCase(),
    }

    const referenceEncodedForSigning = xrplEncodeForSigning(referenceTx)
    expect(result.encodedForSigningHex).toBe(referenceEncodedForSigning)
    expect(result.tx).toEqual(referenceTx)
  })

  it('matches xrpl.encode for a Payment with DestinationTag and a memo', () => {
    const memo = 'vultisig test memo'
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
      destinationTag: 998877,
      memo,
    })

    const memoHex = Buffer.from(memo, 'utf8').toString('hex').toUpperCase()
    const memoTypeHex = Buffer.from('text/plain', 'utf8').toString('hex').toUpperCase()

    const referenceTx: Payment = {
      TransactionType: 'Payment',
      Account: FX.account,
      Destination: FX.destination,
      Amount: FX.amount,
      Fee: FX.fee,
      Sequence: FX.sequence,
      LastLedgerSequence: FX.lastLedgerSequence,
      SigningPubKey: FX.signingPubKey.toUpperCase(),
      DestinationTag: 998877,
      Memos: [{ Memo: { MemoData: memoHex, MemoType: memoTypeHex } }],
    }

    expect(result.tx).toEqual(referenceTx)
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(referenceTx))
  })

  it('treats an equal tag and memo as the legacy tag carrier', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
      destinationTag: 998877,
      memo: '998877',
    })

    expect(result.tx.DestinationTag).toBe(998877)
    expect(result.tx.Memos).toBeUndefined()
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(result.tx))
  })

  it('promotes a canonical numeric memo to a legacy DestinationTag', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
      memo: '123456',
    })

    expect(result.tx.DestinationTag).toBe(123456)
    expect(result.tx.Memos).toBeUndefined()
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(result.tx))
  })

  it('preserves a distinct numeric memo alongside a DestinationTag', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
      destinationTag: 998877,
      memo: '123456',
    })

    expect(result.tx.DestinationTag).toBe(998877)
    expect(result.tx.Memos?.[0].Memo.MemoData).toBe('313233343536')
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(result.tx))
  })

  it('normalizes a known X-address and applies its embedded DestinationTag', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
    })

    expect(result.tx.Destination).toBe('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY')
    expect(result.tx.DestinationTag).toBe(495)
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(result.tx))
  })

  it('preserves DestinationTag zero from a known X-address', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2m4Er6SnvjVLpMWPjR',
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
    })

    expect(result.tx.Destination).toBe('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY')
    expect(result.tx.DestinationTag).toBe(0)
    expect(result.encodedForSigningHex).toBe(xrplEncodeForSigning(result.tx))
  })

  it('rejects an explicit tag that conflicts with the X-address tag', () => {
    expect(() =>
      buildXrpSendTx({
        account: FX.account,
        destination: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        destinationTag: 12345,
        amount: FX.amount,
        fee: FX.fee,
        sequence: FX.sequence,
        lastLedgerSequence: FX.lastLedgerSequence,
        signingPubKey: FX.signingPubKey,
      })
    ).toThrow(/Conflicting XRP destination tags/)
  })

  it('produces a finalized signed blob whose bytes match xrpl.encode of the same signed tx', () => {
    const result = buildXrpSendTx({
      account: FX.account,
      destination: FX.destination,
      amount: FX.amount,
      fee: FX.fee,
      sequence: FX.sequence,
      lastLedgerSequence: FX.lastLedgerSequence,
      signingPubKey: FX.signingPubKey,
    })

    // Fixed deterministic r||s that exercises both finalize branches:
    // - high-bit r triggers strict-DER 0x00 padding
    // - 130-hex input verifies the optional recovery-byte strip
    const rHex = `ff${'0'.repeat(62)}`
    const sHex = '2'.repeat(64) // well below secp256k1 half-order, no normalization needed
    const finalized = result.finalize(rHex + sHex)
    const finalizedWithRecovery = result.finalize(rHex + sHex + '01')

    // DER-encode the same r/s independently (per BIP-62 SEQUENCE{INTEGER r, INTEGER s})
    // to build the reference signed tx, then hand it to xrpl's own encoder.
    const der = buildReferenceDerSignature(rHex, sHex)

    const referenceSignedTx: Payment = {
      TransactionType: 'Payment',
      Account: FX.account,
      Destination: FX.destination,
      Amount: FX.amount,
      Fee: FX.fee,
      Sequence: FX.sequence,
      LastLedgerSequence: FX.lastLedgerSequence,
      SigningPubKey: FX.signingPubKey.toUpperCase(),
      TxnSignature: der.toString('hex').toUpperCase(),
    }

    expect(finalizedWithRecovery).toEqual(finalized)
    expect(finalized.signedTx).toEqual(referenceSignedTx)
    expect(finalized.signedBlobHex).toBe(xrplEncode(referenceSignedTx))
  })
})
