/**
 * ZIP-243 golden signing vector for the Zcash transparent-send sighash
 * (P2 — vultisig/vultisig-sdk#1459, ahead of the 2026-07-28 Ironwood
 * consensus-branch-id rotation).
 *
 * `getSighashZcash` (packages/sdk/src/chains/utxo/tx.ts) hand-rolls ZIP-243's
 * BLAKE2b-personalized transaction digest algorithm for Zcash's still-valid
 * v4/Sapling-framed transparent-only transactions (v4 Sapling txs remain
 * consensus-valid post-NU5/Orchard — see zcashd's ContextualCheckTransaction,
 * which accepts `nVersionGroupId == SAPLING_VERSION_GROUP_ID` alongside
 * ZIP-225/v5; the SDK deliberately never builds v5/ZIP-244/Orchard framing).
 * Nothing previously pinned that hand-rolled digest against an authoritative,
 * independently-computed reference value — `compileTx.golden.test.ts` only
 * pins WalletCore's *own* output for the same wire shape, which is a
 * different implementation entirely and explicitly disclaims covering this
 * builder (see its file-level comment).
 *
 * The expected sighash values below were computed independently in Python,
 * transcribing (unmodified) the digest algorithm from ZIP-243's own reference
 * implementation:
 *   https://github.com/zcash-hackworks/zcash-test-vectors/blob/master/zcash_test_vectors/zip_0243.py
 *   https://github.com/zcash-hackworks/zcash-test-vectors/blob/master/zcash_test_vectors/zip_0143.py
 * (linked from ZIP-243 itself as the canonical test-vector source) for the
 * exact transparent-only, single-input/two-output, SIGHASH_ALL transaction
 * built below — NOT derived from or copy-pasted out of this repo's TS.
 */
import { describe, expect, it } from 'vitest'

import { getSighashZcash, type UtxoInput, ZCASH_BRANCH_ID_NU6_1, ZCASH_BRANCH_ID_NU6_2 } from '../../../src/chains/utxo'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

// Single input, two P2PKH outputs (recipient + change) — matches the shape
// `buildUtxoSendTx` produces for a plain Zcash send with no OP_RETURN memo.
const FROM_PUBKEY_HASH = Uint8Array.from(Buffer.from('aa'.repeat(20), 'hex'))
const TO_PUBKEY_HASH = Uint8Array.from(Buffer.from('bb'.repeat(20), 'hex'))
const CHANGE_PUBKEY_HASH = Uint8Array.from(Buffer.from('cc'.repeat(20), 'hex'))

// Ascending byte sequence (00..1f), deliberately non-palindromic under
// byte-reversal — a repeated-byte hash (e.g. '11'.repeat(32)) would stay
// silently green if `reverseHexBytes`'s internal-vs-display-order flip broke,
// since reversing an all-identical-byte array is a no-op.
const PREVOUT_HASH = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')

const INPUT: UtxoInput = {
  hash: PREVOUT_HASH,
  index: 0,
  value: 200_000n,
}

const p2pkhScript = (pubKeyHash: Uint8Array) => Uint8Array.from([0x76, 0xa9, 0x14, ...pubKeyHash, 0x88, 0xac])

const writeU64LE = (v: bigint) => {
  const b = new Uint8Array(8)
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(i * 8)) & 0xffn)
  return b
}

const serializeP2pkhOutput = (value: bigint, pubKeyHash: Uint8Array) => {
  const script = p2pkhScript(pubKeyHash)
  return Uint8Array.from([...writeU64LE(value), script.length, ...script])
}

const OUTPUTS_RAW = Uint8Array.from([
  ...serializeP2pkhOutput(90_000n, TO_PUBKEY_HASH),
  ...serializeP2pkhOutput(100_000n, CHANGE_PUBKEY_HASH),
])

// Independently computed via the ZIP-243 reference algorithm (see file header) —
// NOT derived from this repo's TypeScript.
const EXPECTED_SIGHASH_NU6_2 = '0b066f10b0ec8d174ff8bb878c8030133c018b8ddfc2ae78ad180ef08d088299'
const EXPECTED_SIGHASH_NU6_1 = '1ea0444cb3105e1a100e25c9070ffb2d2441b0617d11c587476c0b3ee681f073'

describe('Zcash ZIP-243 sighash — golden vector', () => {
  it('matches the independently-computed reference digest at the NU6.2 branch id', () => {
    const sighash = getSighashZcash([INPUT], OUTPUTS_RAW, 0, FROM_PUBKEY_HASH, ZCASH_BRANCH_ID_NU6_2)
    expect(hex(sighash)).toBe(EXPECTED_SIGHASH_NU6_2)
  })

  it('matches the independently-computed reference digest at the NU6.1 branch id (rotation guard)', () => {
    // Same transaction, prior consensus epoch's branch id. Both hashes are
    // independently pinned against the reference algorithm (not just
    // asserted-different from each other), so a regression that keeps the
    // sighash *different*-but-*wrong* across epochs would still be caught —
    // unlike utxo-zcash-branchid.test.ts, which only proves the two differ.
    const sighash = getSighashZcash([INPUT], OUTPUTS_RAW, 0, FROM_PUBKEY_HASH, ZCASH_BRANCH_ID_NU6_1)
    expect(hex(sighash)).toBe(EXPECTED_SIGHASH_NU6_1)
  })
})
