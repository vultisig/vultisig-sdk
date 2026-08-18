import { describe, expect, it } from 'vitest'

import { CosmosSequenceMismatchError, toCosmosSequenceMismatchError } from './cosmosSequenceMismatch'

describe('toCosmosSequenceMismatchError', () => {
  it('classifies an already-consumed signed sequence as requiring a new signing ceremony', () => {
    const source = new Error(
      'Broadcasting transaction failed with code 32 (codespace: sdk). Log: account sequence mismatch, expected 255, got 254: incorrect account sequence'
    )

    expect(toCosmosSequenceMismatchError(source)).toMatchObject({
      name: 'CosmosSequenceMismatchError',
      expectedSequence: 255n,
      signedSequence: 254n,
      recovery: 'resign',
      cause: source,
      message: expect.stringContaining('retrying these signed bytes cannot succeed'),
    })
  })

  it('classifies a future signed sequence as wait-and-retry', () => {
    const mismatch = toCosmosSequenceMismatchError(
      'Broadcasting transaction failed with code 32 (codespace: sdk). Log: account sequence mismatch, expected 254, got 255: incorrect account sequence'
    )

    expect(mismatch).toMatchObject({
      expectedSequence: 254n,
      signedSequence: 255n,
      recovery: 'wait',
      message: expect.stringContaining('Wait for the preceding transaction'),
    })
  })

  it('finds a typed mismatch through the SDK originalError wrapper', () => {
    const mismatch = new CosmosSequenceMismatchError({
      expectedSequence: 255n,
      signedSequence: 254n,
    })
    const wrapped = Object.assign(new Error('Failed to broadcast transaction on Cosmos'), {
      originalError: mismatch,
    })

    expect(toCosmosSequenceMismatchError(wrapped)).toBe(mismatch)
  })

  it('does not classify another code, codespace, or ambiguous message', () => {
    expect(
      toCosmosSequenceMismatchError(
        'Broadcasting transaction failed with code 5 (codespace: sdk). Log: account sequence mismatch, expected 5, got 4: incorrect account sequence'
      )
    ).toBeUndefined()
    expect(
      toCosmosSequenceMismatchError(
        'Broadcasting transaction failed with code 32 (codespace: wasm). Log: account sequence mismatch, expected 5, got 4: incorrect account sequence'
      )
    ).toBeUndefined()
    expect(toCosmosSequenceMismatchError(new Error('account sequence mismatch'))).toBeUndefined()
    expect(
      toCosmosSequenceMismatchError(
        'Broadcasting transaction failed with code 32 (codespace: sdk). Log: account sequence mismatch, expected 18446744073709551616, got 4: incorrect account sequence'
      )
    ).toBeUndefined()
  })
})
