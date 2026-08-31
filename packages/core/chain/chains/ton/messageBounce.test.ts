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

  it('treats a raw address as non-bounceable — it declares no tag', () => {
    expect(getTonMessageBounceable(Address.parse(bounceable).toRawString())).toBe(false)
    expect(getTonMessageBounceable(Address.parse(masterchainBounceable).toRawString())).toBe(false)
  })

  it('treats an unparseable address as non-bounceable instead of throwing', () => {
    const corrupted = `${bounceable.slice(0, -1)}${bounceable.endsWith('A') ? 'B' : 'A'}`

    expect(getTonMessageBounceable(corrupted)).toBe(false)
    expect(getTonMessageBounceable('EQnot-an-address')).toBe(false)
    expect(getTonMessageBounceable('')).toBe(false)
  })
})
