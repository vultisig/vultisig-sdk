import { describe, expect, it } from 'vitest'

import { NoSwapRoutesError } from './NoSwapRoutesError'

describe('NoSwapRoutesError', () => {
  it('is an Error subclass with a stable message', () => {
    const err = new NoSwapRoutesError()
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NoSwapRoutesError)
    expect(err.message).toBe('No swap routes found.')
  })
})
