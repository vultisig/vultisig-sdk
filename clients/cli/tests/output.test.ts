import { afterEach, describe, expect, it } from 'vitest'

import { applyOutputTransforms, filterFields, setFields, setQuiet, stripEmpty } from '../src/lib/output'

describe('filterFields', () => {
  it('returns data unchanged when fields array is empty', () => {
    const data = { chain: 'Ethereum', amount: '1.0' }
    expect(filterFields(data, [])).toEqual(data)
  })

  it('filters top-level keys', () => {
    const data = { chain: 'Ethereum', amount: '1.0', symbol: 'ETH', decimals: 18 }
    expect(filterFields(data, ['chain', 'amount'])).toEqual({ chain: 'Ethereum', amount: '1.0' })
  })

  it('filters arrays of objects', () => {
    const data = [
      { chain: 'Ethereum', amount: '1.0', symbol: 'ETH' },
      { chain: 'Bitcoin', amount: '0.5', symbol: 'BTC' },
    ]
    expect(filterFields(data, ['chain', 'amount'])).toEqual([
      { chain: 'Ethereum', amount: '1.0' },
      { chain: 'Bitcoin', amount: '0.5' },
    ])
  })

  it('recurses into nested objects when no top-level keys match', () => {
    const data = {
      balances: [
        { chain: 'Ethereum', amount: '1.0', symbol: 'ETH' },
        { chain: 'Bitcoin', amount: '0.5', symbol: 'BTC' },
      ],
    }
    const result = filterFields(data, ['chain', 'amount']) as { balances: object[] }
    expect(result.balances).toEqual([
      { chain: 'Ethereum', amount: '1.0' },
      { chain: 'Bitcoin', amount: '0.5' },
    ])
  })

  it('returns primitives unchanged', () => {
    expect(filterFields('hello', ['chain'])).toBe('hello')
    expect(filterFields(42, ['chain'])).toBe(42)
    expect(filterFields(null, ['chain'])).toBe(null)
  })

  it('preserves zero values in filtered output', () => {
    const data = { chain: 'Ethereum', amount: '0', value: 0 }
    expect(filterFields(data, ['chain', 'amount', 'value'])).toEqual({
      chain: 'Ethereum',
      amount: '0',
      value: 0,
    })
  })

  it('returns all fields when all specified fields match', () => {
    const data = { a: 1, b: 2 }
    expect(filterFields(data, ['a', 'b'])).toEqual({ a: 1, b: 2 })
  })
})

describe('stripEmpty', () => {
  it('removes null and empty string values from objects', () => {
    expect(stripEmpty({ a: 1, b: null, c: '', d: 'ok' })).toEqual({ a: 1, d: 'ok' })
  })

  it('preserves zero values', () => {
    expect(stripEmpty({ amount: 0, count: 0n })).toEqual({ amount: 0, count: 0n })
  })

  it('preserves false values', () => {
    expect(stripEmpty({ active: false })).toEqual({ active: false })
  })

  it('does not recurse into nested objects (top-level strip only)', () => {
    const result = stripEmpty({ outer: { a: null, b: 'yes' } }) as Record<string, unknown>
    // stripEmpty only strips at each object level via the filter — nested objects pass as non-null values
    expect(result.outer).toEqual({ a: null, b: 'yes' })
  })

  it('handles arrays of objects', () => {
    const result = stripEmpty([
      { a: null, b: 1 },
      { a: '', b: 2 },
    ])
    expect(result).toEqual([{ b: 1 }, { b: 2 }])
  })

  it('returns primitives unchanged', () => {
    expect(stripEmpty(42)).toBe(42)
    expect(stripEmpty('hello')).toBe('hello')
    expect(stripEmpty(null)).toBe(null)
  })
})

describe('applyOutputTransforms', () => {
  afterEach(() => {
    setQuiet(false)
    setFields(undefined)
  })

  it('returns data unchanged when quiet=false and no field filter', () => {
    const data = { a: 1, b: null, c: '' }
    expect(applyOutputTransforms(data)).toEqual(data)
  })

  it('strips empty values when quiet=true', () => {
    setQuiet(true)
    expect(applyOutputTransforms({ a: 1, b: null, c: '' })).toEqual({ a: 1 })
  })

  it('filters fields when fieldFilter is set', () => {
    setFields(['a'])
    expect(applyOutputTransforms({ a: 1, b: 2, c: 3 })).toEqual({ a: 1 })
  })

  it('applies both quiet and field filter together', () => {
    setQuiet(true)
    setFields(['a', 'b'])
    expect(applyOutputTransforms({ a: 1, b: null, c: 3 })).toEqual({ a: 1 })
  })
})
