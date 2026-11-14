import { describe, expect, it } from 'vitest'

import { buildClaimTxBody, validateClaimInput } from './buildClaimTx'

const readVarint = (bytes: Uint8Array, offset: number) => {
  let value = 0
  let shift = 0
  let position = offset
  while (bytes[position] & 0x80) {
    value += (bytes[position] & 0x7f) * 2 ** shift
    shift += 7
    position++
  }
  value += bytes[position] * 2 ** shift
  return { value, next: position + 1 }
}

/** Splits length-delimited protobuf fields into [fieldNumber, payload] pairs. */
const readLengthDelimitedFields = (bytes: Uint8Array): [number, Uint8Array][] => {
  const fields: [number, Uint8Array][] = []
  let offset = 0
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset)
    const length = readVarint(bytes, tag.next)
    fields.push([tag.value >> 3, bytes.subarray(length.next, length.next + length.value)])
    offset = length.next + length.value
  }
  return fields
}

/** TxBody.messages[0] (Any) → value (MsgClaimWithProof) → its field numbers. */
const readMsgClaimWithProofFieldNumbers = (txBody: Uint8Array) => {
  const [[, anyMsg]] = readLengthDelimitedFields(txBody)
  const [, [, msg]] = readLengthDelimitedFields(anyMsg)
  return readLengthDelimitedFields(msg).map(([field]) => field)
}

const validInput = {
  claimer: 'qbtc1abc',
  utxos: [{ txid: 'aa'.repeat(32), vout: 0 }],
  proof: 'ff'.repeat(200),
  pubKeyHashSha256: 'ee'.repeat(32),
  broadcaster: 'qbtc1abc',
}

describe('validateClaimInput', () => {
  it('accepts valid input', () => {
    expect(() => validateClaimInput(validInput)).not.toThrow()
  })

  it('rejects empty UTXOs', () => {
    expect(() => validateClaimInput({ ...validInput, utxos: [] })).toThrow('UTXOs count must be 1-50')
  })

  it('rejects more than 50 UTXOs', () => {
    const utxos = Array.from({ length: 51 }, (_, i) => ({
      txid: 'aa'.repeat(32),
      vout: i,
    }))
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow('UTXOs count must be 1-50')
  })

  it('rejects duplicate UTXOs', () => {
    const utxos = [
      { txid: 'aa'.repeat(32), vout: 0 },
      { txid: 'aa'.repeat(32), vout: 0 },
    ]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow('Duplicate UTXO reference')
  })

  it('rejects invalid txid length', () => {
    const utxos = [{ txid: 'aa'.repeat(16), vout: 0 }]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow('Invalid txid')
  })

  it('rejects non-hex txid', () => {
    const utxos = [{ txid: 'zz'.repeat(32), vout: 0 }]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow('Invalid txid')
  })

  it('rejects negative vout', () => {
    const utxos = [{ txid: 'aa'.repeat(32), vout: -1 }]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow('Invalid vout')
  })

  it('rejects proof too small', () => {
    expect(() => validateClaimInput({ ...validInput, proof: 'ff'.repeat(50) })).toThrow('Proof too small')
  })

  it('rejects proof too large', () => {
    expect(() => validateClaimInput({ ...validInput, proof: 'ff'.repeat(60_000) })).toThrow('Proof too large')
  })

  it('rejects invalid pubKeyHashSha256 length', () => {
    expect(() => validateClaimInput({ ...validInput, pubKeyHashSha256: 'aa'.repeat(16) })).toThrow(
      'pub_key_hash_sha256 must be 64 hex chars'
    )
  })

  it('rejects empty broadcaster', () => {
    expect(() => validateClaimInput({ ...validInput, broadcaster: '' })).toThrow('broadcaster is required')
  })

  it('rejects empty claimer', () => {
    expect(() => validateClaimInput({ ...validInput, claimer: '' })).toThrow('claimer is required')
  })
})

describe('buildClaimTxBody', () => {
  it('produces non-empty protobuf bytes', () => {
    const result = buildClaimTxBody(validInput)
    expect(result.length).toBeGreaterThan(0)
    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles multiple UTXOs', () => {
    const input = {
      ...validInput,
      utxos: [
        { txid: 'aa'.repeat(32), vout: 0 },
        { txid: 'bb'.repeat(32), vout: 1 },
      ],
    }
    const result = buildClaimTxBody(input)
    expect(result.length).toBeGreaterThan(0)
  })

  it('encodes broadcaster as proto field 9', () => {
    const result = buildClaimTxBody({
      ...validInput,
      broadcaster: 'qbtc1broadcaster',
    })
    // Proto field 9 with wire type 2 (length-delimited) → tag byte 0x4a
    expect(Array.from(result)).toContain(0x4a)
  })

  it('encodes no reserved field 4-6 (removed in btcq-org/qbtc#210)', () => {
    expect(readMsgClaimWithProofFieldNumbers(buildClaimTxBody(validInput))).toEqual([1, 2, 3, 7, 9])
  })
})
