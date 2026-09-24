import { describe, expect, it } from 'vitest'

import { getEvmChecksumMismatchHint, withEvmChecksumHint } from './getEvmChecksumMismatchHint'

// EIP-55 reference vector and its variants.
const checksummed = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const caseFlipped = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD'
const digitTypo = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee'

describe('getEvmChecksumMismatchHint', () => {
  it('returns a hint only for a mixed-case address that fails its EIP-55 checksum', () => {
    expect(getEvmChecksumMismatchHint(caseFlipped)).toMatch(/EIP-55 checksum mismatch/u)
    expect(getEvmChecksumMismatchHint(digitTypo)).toMatch(/EIP-55 checksum mismatch/u)
  })

  it('stays silent for a correct checksum', () => {
    expect(getEvmChecksumMismatchHint(checksummed)).toBeUndefined()
  })

  it('stays silent for uniform-case input, which carries no checksum', () => {
    expect(getEvmChecksumMismatchHint(checksummed.toLowerCase())).toBeUndefined()
    expect(getEvmChecksumMismatchHint(`0x${checksummed.slice(2).toUpperCase()}`)).toBeUndefined()
  })

  it('stays silent for input that is not shaped like an EVM address', () => {
    expect(getEvmChecksumMismatchHint(checksummed.slice(0, -1))).toBeUndefined()
    expect(getEvmChecksumMismatchHint('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBeUndefined()
    expect(getEvmChecksumMismatchHint('')).toBeUndefined()
  })
})

describe('withEvmChecksumHint', () => {
  it('appends the hint in parentheses when it applies', () => {
    expect(withEvmChecksumHint('Invalid receiver address', digitTypo)).toBe(
      'Invalid receiver address (EIP-55 checksum mismatch: this mixed-case address does not match its checksum, so it is probably mistyped. Re-copy it from a trusted source and try again.)'
    )
  })

  it('leaves the message untouched otherwise', () => {
    expect(withEvmChecksumHint('Invalid receiver address', 'not-an-address')).toBe('Invalid receiver address')
    expect(withEvmChecksumHint('Invalid receiver address', checksummed)).toBe('Invalid receiver address')
  })
})
