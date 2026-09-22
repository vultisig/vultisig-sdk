import { describe, expect, it } from 'vitest'

import { getKeyImportCommittee } from '../../../src/services/getKeyImportCommittee'

describe('key import committee', () => {
  it.each(['sdk-a', 'sdk-m', 'sdk-z'])('puts %s first regardless of relay or alphabetical order', initiator => {
    const peers = ['sdk-z', 'sdk-a', 'sdk-m']
    const expected = [initiator, ...peers.filter(peer => peer !== initiator).sort()]
    expect(getKeyImportCommittee(peers, initiator)).toEqual(expected)
    expect(getKeyImportCommittee([...peers].reverse(), initiator)).toEqual(expected)
    expect(peers).toEqual(['sdk-z', 'sdk-a', 'sdk-m'])
  })

  it('rejects a QR initiator that did not join the session', () => {
    expect(() => getKeyImportCommittee(['sdk-a', 'sdk-b'], 'sdk-c')).toThrow('initiator is missing')
  })
})
