import { describe, expect, it } from 'vitest'

import { parseKaminoSharePosition } from './position'

const position = (staked: string, unstaked: string, total: string) => ({
  vaultAddress: 'HDsayqAsDWy3QvANGqh2yNraqcD8Fnjgh73Mhb3WRS5E',
  stakedShares: staked,
  unstakedShares: unstaked,
  totalShares: total,
})

describe('parseKaminoSharePosition', () => {
  it('truncates over-precise reported balances to the mint scale', () => {
    // The endpoint reports up to 14 decimal places for a 6-decimal mint; the
    // extra digits are not a balance anyone can spend.
    const parsed = parseKaminoSharePosition({
      position: position('3137.14326952110994', '0', '3137.14326952110994'),
      shareDecimals: 6,
    })

    expect(parsed?.total.baseUnits).toBe(3_137_143_269n)
    // Inexact truncation is already strictly below the true balance, so no
    // extra base unit is given up.
    expect(parsed?.spendable.baseUnits).toBe(3_137_143_269n)
  })

  it('gives up one base unit when the balance is exactly representable', () => {
    // "The whole balance" is a request the API rewrites to its
    // withdraw-everything sentinel, so the maximum must sit strictly below it.
    const parsed = parseKaminoSharePosition({
      position: position('71.999441', '0', '71.999441'),
      shareDecimals: 6,
    })

    expect(parsed?.total.baseUnits).toBe(71_999_441n)
    expect(parsed?.spendable.baseUnits).toBe(71_999_440n)
  })

  it('floors spendable at zero for an empty position', () => {
    const parsed = parseKaminoSharePosition({ position: position('0', '0', '0'), shareDecimals: 6 })
    expect(parsed?.spendable.baseUnits).toBe(0n)
  })

  it('checks the split against the total at the reported precision', () => {
    // Truncating to the mint scale first would sum one base unit short of the
    // truncated total and refuse a perfectly consistent position.
    const parsed = parseKaminoSharePosition({
      position: position('0.9445485', '0.9595935', '1.904142'),
      shareDecimals: 6,
    })

    expect(parsed?.accountsForItsTotal).toBe(true)
  })

  it('flags a total its parts do not reach', () => {
    const parsed = parseKaminoSharePosition({
      position: position('1', '1', '3'),
      shareDecimals: 6,
    })

    expect(parsed?.accountsForItsTotal).toBe(false)
    expect(parsed?.isPlausible).toBe(true)
  })

  it('flags a part exceeding the total as implausible', () => {
    const parsed = parseKaminoSharePosition({
      position: position('4', '0', '3'),
      shareDecimals: 6,
    })

    expect(parsed?.isPlausible).toBe(false)
  })

  it('flags parts that individually fit but together exceed the total', () => {
    const parsed = parseKaminoSharePosition({
      position: position('2', '2', '3'),
      shareDecimals: 6,
    })

    expect(parsed?.isPlausible).toBe(false)
  })

  it('compares the sum against the total at reported precision, not the mint scale', () => {
    // Truncated to 6 decimals both sides read 1.000001, but the reported sum
    // exceeds the reported total by one 7th-decimal digit.
    const parsed = parseKaminoSharePosition({
      position: position('1.0000015', '0', '1.0000011'),
      shareDecimals: 6,
    })

    expect(parsed?.isPlausible).toBe(false)
  })

  it('treats an unreadable value as a failed read, not a zero balance', () => {
    expect(parseKaminoSharePosition({ position: position('1,5', '0', '1.5'), shareDecimals: 6 })).toBeUndefined()
    expect(parseKaminoSharePosition({ position: position('1', '0', ''), shareDecimals: 6 })).toBeUndefined()
  })
})
