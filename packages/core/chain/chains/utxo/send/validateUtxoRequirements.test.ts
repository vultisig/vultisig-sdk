import { describe, expect, it } from 'vitest'

import { Chain } from '../../../Chain'
import { validateUtxoRequirements } from './validateUtxoRequirements'

describe('validateUtxoRequirements', () => {
  it('reports genuine insufficient funds before dust-change guidance', () => {
    expect(
      validateUtxoRequirements({
        amount: 10_000n,
        balance: 10_100n,
        chain: Chain.Bitcoin,
        fee: 200n,
      })
    ).toBe('Insufficient balance to cover amount and network fees.')
  })

  it('reports insufficient funds while dust validation is deferred', () => {
    expect(
      validateUtxoRequirements({
        amount: 10_200n,
        balance: 10_100n,
        chain: Chain.Bitcoin,
        skipDustCheck: true,
      })
    ).toBe('Insufficient balance to cover amount and network fees.')
  })

  it('keeps the dust-change warning for positive sub-dust change', () => {
    expect(
      validateUtxoRequirements({
        amount: 10_000n,
        balance: 10_600n,
        chain: Chain.Bitcoin,
        fee: 100n,
      })
    ).toBe("This amount would leave too little change. 💡 Try 'Max' to avoid this issue.")
  })

  it('accepts exact max-send balance', () => {
    expect(
      validateUtxoRequirements({
        amount: 10_000n,
        balance: 10_100n,
        chain: Chain.Bitcoin,
        fee: 100n,
      })
    ).toBeUndefined()
  })
})
