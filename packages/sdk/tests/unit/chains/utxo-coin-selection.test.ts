/**
 * Golden-vector coverage for `selectUtxoInputs` (UTXO-01).
 *
 * Before this module existed, `getUtxos` fetched every unspent output for an
 * address and `buildUtxoSendTx` took the full array through verbatim (its own
 * doc comment claimed "caller handles coin-selection" but nothing did). That:
 *   - overpays fees for all N inputs when a handful would cover the send
 *   - false-positives "insufficient funds" when fee(N) > balance even though
 *     a small subset would cover amount + fee
 *   - links every UTXO the wallet owns into one tx (privacy)
 *
 * `selectUtxoInputs` picks the smallest largest-first prefix of `utxos` that
 * covers `amount + fee(k)`, using `estimateUtxoTxFee` — the SAME size/fee
 * formula `buildUtxoSendTx` itself now calls (extracted, not duplicated) — so
 * selection and build always agree.
 *
 * Every boundary case is parametrized across all 6 UTXO chains, since the
 * fee formula (bytesPerInput, dust, and the Zcash-only ZIP-317 floor) varies
 * per chain and a fix that only works for BTC-shaped chains is not a fix.
 *
 * The output-count assertions read `buildUtxoSendTx`'s own `unsignedRawHex`
 * via `parseOutputCount` — the real production wire format, not a
 * reimplementation — so a change/dust-output regression in `buildUtxoSendTx`
 * would be caught here too, not just in `selectUtxoInputs`'s own return
 * values.
 */
import { describe, expect, it } from 'vitest'

import { selectUtxoInputs } from '../../../src/chains/utxo/select'
import {
  buildUtxoSendTx,
  estimateUtxoTxFee,
  getUtxoChainSpec,
  type UtxoChainName,
  type UtxoInput,
} from '../../../src/chains/utxo/tx'

const COMPRESSED_PUBKEY = Uint8Array.from(
  '02'
    .concat('aa'.repeat(32))
    .match(/.{2}/g)!
    .map(b => parseInt(b, 16))
)

type ChainFixture = {
  chain: UtxoChainName
  fromAddress: string
  toAddress: string
  feeRate: number
  /** Required only for Zcash's ZIP-243 sighash / v4 tx assembly. */
  zcashBranchId?: number
}

// Addresses generated with the SDK's own encoding primitives (bech32 /
// bs58check) over a fixed 20-byte hash, then round-tripped through
// `decodeAddressToPubKeyHash` to confirm they decode to the chain's expected
// scriptType before use here (see PR description for the verification script).
const CHAINS: ChainFixture[] = [
  {
    chain: 'Bitcoin',
    fromAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    feeRate: 10,
  },
  {
    chain: 'Litecoin',
    fromAddress: 'ltc1q424242424242424242424242424242420clm8p',
    toAddress: 'ltc1q424242424242424242424242424242420clm8p',
    feeRate: 10,
  },
  {
    chain: 'Dogecoin',
    fromAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    toAddress: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
    feeRate: 1,
  },
  {
    chain: 'Dash',
    fromAddress: 'XrFF9zX66qCB2u2JsqCmWcXyvLkeqRM3Zi',
    toAddress: 'XrFF9zX66qCB2u2JsqCmWcXyvLkeqRM3Zi',
    feeRate: 1,
  },
  {
    chain: 'Bitcoin-Cash',
    fromAddress: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
    toAddress: 'bitcoincash:qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a',
    feeRate: 1,
  },
  {
    chain: 'Zcash',
    fromAddress: 't1ZS1L5HL7SmBUbUcxNhfntx7LfN3d2qT1W',
    toAddress: 't1ZS1L5HL7SmBUbUcxNhfntx7LfN3d2qT1W',
    feeRate: 1,
    zcashBranchId: 0x4dec4df0,
  },
]

let nextHashByte = 0
function utxo(value: bigint, index = 0): UtxoInput {
  nextHashByte = (nextHashByte + 1) % 256
  const hash = nextHashByte.toString(16).padStart(2, '0').repeat(32)
  return { hash, index, value }
}

/**
 * Read the output count straight out of `buildUtxoSendTx`'s `unsignedRawHex`.
 * The pre-signing layout is IDENTICAL across all 6 chains (see the "Unsigned
 * preimage-shape bytes" block in tx.ts): 4-byte version [+4-byte Zcash
 * version-group-id] + varint(inputCount) + inputCount * (32-byte hash +
 * 4-byte index + 1-byte empty-scriptSig-varint + 4-byte sequence) +
 * outputsWithCount (varint(numOutputs) + outputs...). All varints here are
 * < 0xfd (single input-count and output-count bytes), matching every case in
 * this suite.
 */
function parseOutputCount(unsignedRawHex: string, chain: UtxoChainName, inputCount: number): number {
  const bytes = Buffer.from(unsignedRawHex, 'hex')
  let offset = chain === 'Zcash' ? 8 : 4 // version [+ version-group-id]
  offset += 1 // varint(inputCount), assumed < 0xfd
  offset += inputCount * (32 + 4 + 1 + 4)
  return bytes[offset]!
}

function buildFor(fixture: ChainFixture, amount: bigint, inputs: UtxoInput[]) {
  return buildUtxoSendTx({
    chain: fixture.chain,
    fromAddress: fixture.fromAddress,
    toAddress: fixture.toAddress,
    amount,
    utxos: inputs,
    feeRate: fixture.feeRate,
    compressedPubKey: COMPRESSED_PUBKEY,
    zcashBranchId: fixture.zcashBranchId,
  })
}

describe.each(CHAINS)('selectUtxoInputs — $chain', fixture => {
  const { chain, feeRate } = fixture
  const dustLimit = getUtxoChainSpec(chain).dustLimit
  // Scaled off the chain's own dust limit so the fixture amount is always a
  // "real" send (Dogecoin's dust is 1_000_000n; Bitcoin's is 546n) without
  // hand-tuning per-chain magic numbers.
  const amount = dustLimit * 500n

  it('case 1: a single UTXO that comfortably covers amount+fee selects just it (no regression to the trivial case)', () => {
    const fee1 = estimateUtxoTxFee(chain, 1, feeRate)
    const big = utxo(amount * 3n)
    const result = selectUtxoInputs({ chain, utxos: [big], amount, feeRate })

    expect(result.inputs).toEqual([big])
    expect(result.fee).toBe(fee1)
    expect(result.change).toBe(big.value - amount - fee1)
    expect(result.change).toBeGreaterThan(dustLimit)

    const built = buildFor(fixture, amount, result.inputs)
    expect(parseOutputCount(built.unsignedRawHex, chain, 1)).toBe(2) // recipient + change
  })

  it('case 2: many small UTXOs accumulate the minimal covering subset, fee recalculated as inputs grow', () => {
    // 6 equal-value UTXOs; unit chosen so 4 fall short of amount+fee but 5
    // covers it (4*unit === amount exactly, and fee > 0 always pushes past
    // that boundary) — this holds for every chain's fee formula because we
    // derive the boundary from `amount`, not a hardcoded per-chain constant.
    const unit = amount / 4n
    const utxos = Array.from({ length: 6 }, (_, i) => utxo(unit, i))
    const result = selectUtxoInputs({ chain, utxos, amount, feeRate })
    const k = result.inputs.length

    expect(k).toBeGreaterThan(1) // needed several
    expect(k).toBeLessThan(utxos.length) // did NOT take every UTXO in the wallet (privacy/fee win)
    expect(result.fee).toBe(estimateUtxoTxFee(chain, k, feeRate))
    expect(BigInt(k) * unit).toBeGreaterThanOrEqual(amount + result.fee) // covers
    expect(BigInt(k - 1) * unit).toBeLessThan(amount + estimateUtxoTxFee(chain, k - 1, feeRate)) // k-1 would NOT have covered (minimal)

    const built = buildFor(fixture, amount, result.inputs)
    expect(parseOutputCount(built.unsignedRawHex, chain, k)).toBe(2) // recipient + change
  })

  it('case 3: exact cover (selected total === amount+fee) leaves zero change and emits no change output', () => {
    const fee1 = estimateUtxoTxFee(chain, 1, feeRate)
    const exact = utxo(amount + fee1)
    const result = selectUtxoInputs({ chain, utxos: [exact], amount, feeRate })

    expect(result.inputs).toEqual([exact])
    expect(result.change).toBe(0n)

    const built = buildFor(fixture, amount, result.inputs)
    expect(parseOutputCount(built.unsignedRawHex, chain, 1)).toBe(1) // recipient only, no dust/zero-value change output
  })

  it('case 4: change below the dust threshold is folded into the fee, not emitted as a dust output', () => {
    const fee1 = estimateUtxoTxFee(chain, 1, feeRate)
    const dustyChange = dustLimit > 1n ? dustLimit / 2n : 1n
    const dusty = utxo(amount + fee1 + dustyChange)
    const result = selectUtxoInputs({ chain, utxos: [dusty], amount, feeRate })

    expect(result.inputs).toEqual([dusty])
    expect(result.change).toBe(dustyChange)
    expect(result.change).toBeGreaterThan(0n)
    expect(result.change).toBeLessThanOrEqual(dustLimit)

    const built = buildFor(fixture, amount, result.inputs)
    // buildUtxoSendTx's serializeOutputs only emits change when change > dustLimit
    // (see UTXO_SPECS/serializeOutputs in tx.ts) — the sub-dust amount here
    // silently becomes extra fee for the miner rather than a stuck/non-standard output.
    expect(parseOutputCount(built.unsignedRawHex, chain, 1)).toBe(1) // recipient only
  })

  it('case 5: genuinely insufficient funds throws the same "insufficient funds" shape buildUtxoSendTx throws', () => {
    const short = utxo(amount / 2n) // even fee(1) can't close this gap
    let selectError: Error | undefined
    try {
      selectUtxoInputs({ chain, utxos: [short], amount, feeRate })
    } catch (e) {
      selectError = e as Error
    }
    expect(selectError?.message).toMatch(/^insufficient funds: have=\d+ need=\d+ \(amount=\d+ fee=\d+\)$/)

    let buildError: Error | undefined
    try {
      buildFor(fixture, amount, [short])
    } catch (e) {
      buildError = e as Error
    }
    expect(buildError?.message).toBe(selectError?.message) // selection and build agree even on failure
  })

  it('case 6: send-max consumes every UTXO regardless of whether a smaller subset would cover a smaller amount', () => {
    const utxos = [utxo(amount * 5n, 0), utxo(amount / 10n, 1), utxo(amount / 20n, 2)]
    const smallAmount = dustLimit * 10n // trivially coverable by the first UTXO alone

    const normal = selectUtxoInputs({ chain, utxos, amount: smallAmount, feeRate })
    expect(normal.inputs).toHaveLength(1) // greedy: only takes what it needs

    const total = utxos.reduce((sum, u) => sum + u.value, 0n)
    const feeAll = estimateUtxoTxFee(chain, utxos.length, feeRate)
    const maxAmount = total - feeAll // "send whole balance": amount = total - fee(N)

    const max = selectUtxoInputs({ chain, utxos, amount: maxAmount, feeRate, sendMax: true })
    expect(max.inputs).toHaveLength(utxos.length) // takes EVERY utxo, not just enough
    expect(max.fee).toBe(feeAll)
    expect(max.change).toBe(0n)

    const built = buildFor(fixture, maxAmount, max.inputs)
    expect(parseOutputCount(built.unsignedRawHex, chain, utxos.length)).toBe(1) // whole balance sent, no change
  })

  it('rejects an empty UTXO set with the same message buildUtxoSendTx uses', () => {
    expect(() => selectUtxoInputs({ chain, utxos: [], amount, feeRate })).toThrow('no UTXOs provided')
  })

  it('rejects a non-positive amount with the same message buildUtxoSendTx uses', () => {
    expect(() => selectUtxoInputs({ chain, utxos: [utxo(amount)], amount: 0n, feeRate })).toThrow(
      'amount must be greater than zero'
    )
  })
})

describe('estimateUtxoTxFee — extraction regression guard', () => {
  it("matches buildUtxoSendTx's own computed fee for every chain (selection <-> build agreement, UTXO-01)", () => {
    for (const fixture of CHAINS) {
      const dustLimit = getUtxoChainSpec(fixture.chain).dustLimit
      const amount = dustLimit * 500n
      const fee1 = estimateUtxoTxFee(fixture.chain, 1, fixture.feeRate)
      // Underfund by exactly 1 base unit so buildUtxoSendTx's "insufficient
      // funds" error reports the EXACT fee it computed internally — compare
      // against estimateUtxoTxFee's standalone output.
      const short = utxo(amount + fee1 - 1n)
      expect(() => buildFor(fixture, amount, [short])).toThrowError(new RegExp(`fee=${fee1}\\)$`))
    }
  })
})
