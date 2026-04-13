import { describe, expect, it } from 'vitest'

import { buildClaimTxBody, validateClaimInput } from './buildClaimTx'

const validInput = {
  claimer: 'qbtc1abc',
  utxos: [{ txid: 'aa'.repeat(32), vout: 0 }],
  proof: 'ff'.repeat(200),
  messageHash: 'bb'.repeat(32),
  addressHash: 'cc'.repeat(20),
  qbtcAddressHash: 'dd'.repeat(32),
}

describe('validateClaimInput', () => {
  it('accepts valid input', () => {
    expect(() => validateClaimInput(validInput)).not.toThrow()
  })

  it('rejects empty UTXOs', () => {
    expect(() =>
      validateClaimInput({ ...validInput, utxos: [] })
    ).toThrow('UTXOs count must be 1-50')
  })

  it('rejects more than 50 UTXOs', () => {
    const utxos = Array.from({ length: 51 }, (_, i) => ({
      txid: 'aa'.repeat(32),
      vout: i,
    }))
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow(
      'UTXOs count must be 1-50'
    )
  })

  it('rejects duplicate UTXOs', () => {
    const utxos = [
      { txid: 'aa'.repeat(32), vout: 0 },
      { txid: 'aa'.repeat(32), vout: 0 },
    ]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow(
      'Duplicate UTXO reference'
    )
  })

  it('rejects invalid txid length', () => {
    const utxos = [{ txid: 'aa'.repeat(16), vout: 0 }]
    expect(() => validateClaimInput({ ...validInput, utxos })).toThrow(
      'Invalid txid length'
    )
  })

  it('rejects proof too small', () => {
    expect(() =>
      validateClaimInput({ ...validInput, proof: 'ff'.repeat(50) })
    ).toThrow('Proof too small')
  })

  it('rejects proof too large', () => {
    expect(() =>
      validateClaimInput({ ...validInput, proof: 'ff'.repeat(60_000) })
    ).toThrow('Proof too large')
  })

  it('rejects invalid messageHash length', () => {
    expect(() =>
      validateClaimInput({ ...validInput, messageHash: 'aa'.repeat(16) })
    ).toThrow('message_hash must be 64 hex chars')
  })

  it('rejects invalid addressHash length', () => {
    expect(() =>
      validateClaimInput({ ...validInput, addressHash: 'aa'.repeat(16) })
    ).toThrow('address_hash must be 40 hex chars')
  })

  it('rejects invalid qbtcAddressHash length', () => {
    expect(() =>
      validateClaimInput({ ...validInput, qbtcAddressHash: 'aa'.repeat(16) })
    ).toThrow('qbtc_address_hash must be 64 hex chars')
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
})
