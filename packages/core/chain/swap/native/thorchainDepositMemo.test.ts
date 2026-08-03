import { describe, expect, it } from 'vitest'

import { assertValidThorchainDepositMemo } from './thorchainDepositMemo'

describe('assertValidThorchainDepositMemo', () => {
  it.each([
    ['LP add', '+:BTC.BTC'],
    ['LP add with paired address', '+:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2'],
    ['LP add long form', 'add:BTC.BTC'],
    ['LP withdraw', '-:BTC.BTC:10000:BTC'],
    ['LP withdraw long form', 'withdraw:BTC.BTC:10000'],
    ['bond', 'bond:thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'],
    ['unbond', 'unbond:thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm:100000000'],
    ['leave', 'leave:thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'],
    ['donate', 'donate:BTC.BTC'],
    ['case-insensitive prefix', 'BOND:thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'],
  ])('accepts a %s memo', (_label, memo) => {
    expect(() => assertValidThorchainDepositMemo(memo)).not.toThrow()
  })

  it('rejects an empty memo', () => {
    expect(() => assertValidThorchainDepositMemo('')).toThrow(/non-empty string/)
  })

  it('rejects a memo with an unrecognized action prefix', () => {
    expect(() => assertValidThorchainDepositMemo('yeet:BTC.BTC')).toThrow(
      /not a recognized THORChain\/MayaChain deposit memo action/
    )
  })

  it('rejects a swap memo — swaps route through the native quote path, not this generic MsgDeposit builder', () => {
    expect(() => assertValidThorchainDepositMemo('=:BTC.BTC:bc1qdest')).toThrow(
      /not a recognized THORChain\/MayaChain deposit memo action/
    )
  })

  it('rejects an LP add memo with a malformed pool id', () => {
    expect(() => assertValidThorchainDepositMemo('+:not-a-pool')).toThrow(/not a valid THORChain pool id/)
  })

  it('rejects an LP withdraw memo with a malformed pool id', () => {
    expect(() => assertValidThorchainDepositMemo('-:btc/btc:10000')).toThrow(/not a valid THORChain pool id/)
  })

  it('rejects a memo containing a newline', () => {
    expect(() => assertValidThorchainDepositMemo('+:BTC.BTC\n:evil')).toThrow(/printable ASCII/)
  })

  it('rejects a memo with leading/trailing whitespace', () => {
    expect(() => assertValidThorchainDepositMemo(' +:BTC.BTC')).toThrow(/printable ASCII/)
  })

  it('rejects a memo exceeding the byte-length budget', () => {
    expect(() => assertValidThorchainDepositMemo(`bond:${'a'.repeat(300)}`)).toThrow(/exceeding/)
  })
})
