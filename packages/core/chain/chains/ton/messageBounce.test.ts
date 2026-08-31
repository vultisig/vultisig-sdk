import { Address } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { getTonMessageBounceable } from './messageBounce'

const bounceable = 'EQCIcjES4cQET0z6nRixZ0MdvTB4u3_8triztLSrIIrDkpgJ'
const nonBounceable = 'UQDmLe6ticcY_uLZsfurdYONshNuCn8IS81KcJ8p6M6ISMcB'
const masterchainBounceable = 'Ef8t6cZkqFuHjJ_a_ydEK_tu3LHWRA4JZXRyewLY4j8FZ6B5'

describe('getTonMessageBounceable', () => {
  it('reads the bounce tag of a user-friendly address', () => {
    expect(getTonMessageBounceable(bounceable)).toBe(true)
    expect(getTonMessageBounceable(nonBounceable)).toBe(false)
  })

  it('reads the tag on a masterchain address', () => {
    expect(getTonMessageBounceable(masterchainBounceable)).toBe(true)
  })

  it('reads the tag regardless of the testnet bit', () => {
    const address = Address.parse(bounceable)

    expect(getTonMessageBounceable(address.toString({ bounceable: true, testOnly: true }))).toBe(true)
    expect(getTonMessageBounceable(address.toString({ bounceable: false, testOnly: true }))).toBe(false)
  })

  it('treats a raw address without stateInit as bounceable', () => {
    expect(getTonMessageBounceable(Address.parse(bounceable).toRawString())).toBe(true)
    expect(getTonMessageBounceable(Address.parse(masterchainBounceable).toRawString())).toBe(true)
  })

  it('accepts the canonical raw form whatever the hex case', () => {
    expect(getTonMessageBounceable(Address.parse(bounceable).toRawString().toUpperCase())).toBe(true)
  })

  it('treats a raw deployment destination with stateInit as non-bounceable', () => {
    expect(getTonMessageBounceable(Address.parse(bounceable).toRawString(), true)).toBe(false)
    expect(getTonMessageBounceable(Address.parse(masterchainBounceable).toRawString(), true)).toBe(false)
  })

  // `Address.parseRaw` accepts these without throwing (it `parseInt`s the workchain),
  // so the round-trip check is what keeps a malformed destination from being signed
  // bounceable.
  it('treats a malformed raw address as non-bounceable', () => {
    const hash = Address.parse(bounceable).hash.toString('hex')

    expect(getTonMessageBounceable(`0junk:${hash}`)).toBe(false)
    expect(getTonMessageBounceable(`00:${hash}`)).toBe(false)
    expect(getTonMessageBounceable(`0x0:${hash}`)).toBe(false)
    expect(getTonMessageBounceable(`0:${hash.slice(0, -2)}`)).toBe(false)
    expect(getTonMessageBounceable(`0junk:${hash}`, true)).toBe(false)
  })

  it('treats an unparseable address as non-bounceable instead of throwing', () => {
    const corrupted = `${bounceable.slice(0, -1)}${bounceable.endsWith('A') ? 'B' : 'A'}`

    expect(getTonMessageBounceable(corrupted)).toBe(false)
    expect(getTonMessageBounceable('EQnot-an-address')).toBe(false)
    expect(getTonMessageBounceable('')).toBe(false)
  })
})
