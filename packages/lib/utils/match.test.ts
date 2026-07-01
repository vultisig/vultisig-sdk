import { describe, expect, it } from 'vitest'

import { match } from './match'

describe('match', () => {
  it('dispatches to the correct handler', () => {
    const result = match('a' as 'a' | 'b', {
      a: () => 1,
      b: () => 2,
    })
    expect(result).toBe(1)
  })

  it('throws a clean typed error when value has no handler - not a raw TypeError', () => {
    // Simulates what happens at runtime when an undefined / unknown value
    // is passed to match() via a loose external caller or a chain enum that
    // was added without updating all match sites.
    const run = () =>
      match('unknown' as unknown as 'a' | 'b', {
        a: () => 1,
        b: () => 2,
      })

    // must throw
    expect(run).toThrow()

    let caught: unknown
    try {
      run()
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const msg = (caught as Error).message
    // domain message must mention 'no handler'
    expect(msg).toMatch(/no handler/)
    // must NOT be the raw JS engine error
    expect(msg).not.toMatch(/is not a function/)
    expect(msg).not.toMatch(/Cannot read properties/)
  })

  it('includes the offending value in the error message', () => {
    let caught: Error | undefined
    try {
      match('undefined_chain' as unknown as 'a', { a: () => 0 })
    } catch (e) {
      caught = e as Error
    }
    expect(caught?.message).toContain('undefined_chain')
  })

  it('throws a clean error for undefined value', () => {
    let caught: Error | undefined
    try {
      match(undefined as unknown as 'a', { a: () => 0 })
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught?.message).toMatch(/no handler/)
    expect(caught?.message).not.toMatch(/is not a function/)
  })
})
