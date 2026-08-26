import { describe, expect, it } from 'vitest'

import { DklsMaliciousPartyError, getDklsAbortAndBanPartyCode, isDklsAbortAndBanPartyCode } from './error'

describe('isDklsAbortAndBanPartyCode', () => {
  it('matches only DKLS abort-and-ban party codes', () => {
    expect(isDklsAbortAndBanPartyCode(99)).toBe(false)
    expect(isDklsAbortAndBanPartyCode(100)).toBe(true)
    expect(isDklsAbortAndBanPartyCode(109)).toBe(true)
    expect(isDklsAbortAndBanPartyCode(110)).toBe(false)
  })
})

describe('getDklsAbortAndBanPartyCode', () => {
  it('extracts native coded exception messages', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('signSessionInputMessage failed (code: 103)'))).toBe(103)
  })

  it('extracts iOS native error code messages', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('signSessionFinish failed with error code 103'))).toBe(103)
  })

  it('extracts symbolic DKLS abort-and-ban constants', () => {
    expect(getDklsAbortAndBanPartyCode('LIB_ABORT_PROTOCOL_AND_BAN_PARTY_10')).toBe(109)
  })

  it('ignores unrelated DKLS abort codes', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('signSessionInputMessage failed (code: 200)'))).toBeUndefined()
  })
})

describe('DklsMaliciousPartyError', () => {
  it('names the malicious party from the native code', () => {
    const error = new DklsMaliciousPartyError(104)

    expect(error.name).toBe('DklsMaliciousPartyError')
    expect(error.message).toContain('party 5')
  })
})
