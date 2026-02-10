import { describe, expect, it } from 'vitest'

import { isRetryableError, RujiraError, RujiraErrorCode, wrapError } from '../errors.js'

describe('wrapError', () => {
  it('returns RujiraError unchanged', () => {
    const original = new RujiraError(RujiraErrorCode.TIMEOUT, 'test')
    expect(wrapError(original)).toBe(original)
  })

  describe('tier 1: typed error classes', () => {
    it('maps TimeoutError by name', () => {
      const err = new Error('timed out')
      err.name = 'TimeoutError'
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.TIMEOUT)
      expect(wrapped.retryable).toBe(true)
    })
  })

  describe('tier 2: error.code property', () => {
    it('maps ECONNREFUSED to NETWORK_ERROR (retryable)', () => {
      const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.NETWORK_ERROR)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps ENOTFOUND to NETWORK_ERROR (retryable)', () => {
      const err = Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.NETWORK_ERROR)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps ECONNRESET to NETWORK_ERROR (retryable)', () => {
      const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.NETWORK_ERROR)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps ETIMEDOUT to TIMEOUT', () => {
      const err = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.TIMEOUT)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps gRPC DEADLINE_EXCEEDED (4) to TIMEOUT', () => {
      const err = Object.assign(new Error('deadline'), { code: 4 })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.TIMEOUT)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps gRPC DEADLINE_EXCEEDED (string) to TIMEOUT', () => {
      const err = Object.assign(new Error('deadline'), { code: 'DEADLINE_EXCEEDED' })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.TIMEOUT)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps gRPC NOT_FOUND (5) to CONTRACT_NOT_FOUND', () => {
      const err = Object.assign(new Error('nf'), { code: 5 })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.CONTRACT_NOT_FOUND)
      expect(wrapped.retryable).toBe(false)
    })

    it('maps gRPC UNAVAILABLE (14) to RPC_ERROR (retryable)', () => {
      const err = Object.assign(new Error('unavailable'), { code: 14 })
      const wrapped = wrapError(err)
      expect(wrapped.code).toBe(RujiraErrorCode.RPC_ERROR)
      expect(wrapped.retryable).toBe(true)
    })
  })

  describe('tier 3: string matching (fallback)', () => {
    it('maps "insufficient funds" to INSUFFICIENT_BALANCE', () => {
      const wrapped = wrapError(new Error('insufficient funds for gas'))
      expect(wrapped.code).toBe(RujiraErrorCode.INSUFFICIENT_BALANCE)
    })

    it('maps "timeout" to TIMEOUT', () => {
      const wrapped = wrapError(new Error('request timeout'))
      expect(wrapped.code).toBe(RujiraErrorCode.TIMEOUT)
      expect(wrapped.retryable).toBe(true)
    })

    it('maps "slippage" to SLIPPAGE_EXCEEDED', () => {
      const wrapped = wrapError(new Error('slippage too high'))
      expect(wrapped.code).toBe(RujiraErrorCode.SLIPPAGE_EXCEEDED)
    })

    it('maps "out of gas" to INSUFFICIENT_GAS', () => {
      const wrapped = wrapError(new Error('out of gas'))
      expect(wrapped.code).toBe(RujiraErrorCode.INSUFFICIENT_GAS)
    })

    it('maps "contract not found" to CONTRACT_NOT_FOUND', () => {
      const wrapped = wrapError(new Error('contract not found at address'))
      expect(wrapped.code).toBe(RujiraErrorCode.CONTRACT_NOT_FOUND)
    })

    it('uses default code for unrecognized errors', () => {
      const wrapped = wrapError(new Error('something weird'))
      expect(wrapped.code).toBe(RujiraErrorCode.NETWORK_ERROR)
    })

    it('respects custom default code', () => {
      const wrapped = wrapError(new Error('something weird'), RujiraErrorCode.CONTRACT_ERROR)
      expect(wrapped.code).toBe(RujiraErrorCode.CONTRACT_ERROR)
    })
  })

  describe('tier priority: code beats string match', () => {
    it('ECONNREFUSED with "timeout" in message still maps to NETWORK_ERROR', () => {
      const err = Object.assign(new Error('connection timeout refused'), { code: 'ECONNREFUSED' })
      const wrapped = wrapError(err)
      // code property (tier 2) should take precedence over string match (tier 3)
      expect(wrapped.code).toBe(RujiraErrorCode.NETWORK_ERROR)
    })
  })

  it('wraps non-Error values', () => {
    const wrapped = wrapError('string error')
    expect(wrapped).toBeInstanceOf(RujiraError)
    expect(wrapped.message).toBe('string error')
  })

  it('wraps null/undefined', () => {
    const wrapped = wrapError(null)
    expect(wrapped).toBeInstanceOf(RujiraError)

    const wrapped2 = wrapError(undefined)
    expect(wrapped2).toBeInstanceOf(RujiraError)
  })
})

describe('isRetryableError', () => {
  it('returns true for retryable RujiraError', () => {
    const err = new RujiraError(RujiraErrorCode.TIMEOUT, 'test', undefined, true)
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns true for NETWORK_ERROR code', () => {
    const err = new RujiraError(RujiraErrorCode.NETWORK_ERROR, 'test')
    expect(isRetryableError(err)).toBe(true)
  })

  it('returns false for non-retryable error', () => {
    const err = new RujiraError(RujiraErrorCode.INVALID_AMOUNT, 'test')
    expect(isRetryableError(err)).toBe(false)
  })

  it('returns false for non-RujiraError', () => {
    expect(isRetryableError(new Error('test'))).toBe(false)
    expect(isRetryableError('string')).toBe(false)
  })
})

describe('RujiraError', () => {
  it('has correct name', () => {
    const err = new RujiraError(RujiraErrorCode.TIMEOUT, 'test')
    expect(err.name).toBe('RujiraError')
  })

  it('serializes to JSON', () => {
    const err = new RujiraError(RujiraErrorCode.TIMEOUT, 'test msg', { detail: 1 }, true)
    const json = err.toJSON()
    expect(json.code).toBe('TIMEOUT')
    expect(json.message).toBe('test msg')
    expect(json.details).toEqual({ detail: 1 })
    expect(json.retryable).toBe(true)
  })

  it('provides user-friendly messages', () => {
    const err = new RujiraError(RujiraErrorCode.TIMEOUT, 'internal detail')
    expect(err.toUserMessage()).toBe('Request timed out. Please try again.')
  })
})
