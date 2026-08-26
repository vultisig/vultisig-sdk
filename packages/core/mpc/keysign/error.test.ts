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

  it('extracts the Android symbolic-in-context shape', () => {
    expect(
      getDklsAbortAndBanPartyCode(
        new Error('signSessionInputMessage failed (code: LIB_ABORT_PROTOCOL_AND_BAN_PARTY_4)')
      )
    ).toBe(103)
  })

  it('extracts the vs-wasm SignError display string (0-based party id)', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('Abort the protocol and ban the party ID 3'))).toBe(103)
  })

  it('ignores unrelated DKLS abort codes', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('signSessionInputMessage failed (code: 200)'))).toBeUndefined()
  })

  it('does not false-positive on unrelated "code:" messages', () => {
    expect(getDklsAbortAndBanPartyCode(new Error('Request failed with status code: 103'))).toBeUndefined()
  })
})

describe('DklsMaliciousPartyError', () => {
  it('names the malicious party from the native code', () => {
    const error = new DklsMaliciousPartyError(104)

    expect(error.name).toBe('DklsMaliciousPartyError')
    expect(error.message).toContain('party 5')
    expect(error.partyIndex).toBe(5)
    expect(error.partyId).toBeUndefined()
  })
})
