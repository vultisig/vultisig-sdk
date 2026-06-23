import { describe, expect, it } from 'vitest'

import { isMalformedEvmAddress, isNullAddress, isSelfSend, recipientSanity } from '@/tools/validate/recipientSanity'

const EVM_ZERO = '0x0000000000000000000000000000000000000000'
const EVM_DEAD = '0x000000000000000000000000000000000000dEaD'
const SOL_SYSTEM = '11111111111111111111111111111111'
const SOL_INCINERATOR = '1nc1nerator11111111111111111111111111111111'
const VALID_EVM = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'

describe('isNullAddress', () => {
  it('flags the EVM zero address', () => {
    expect(isNullAddress(EVM_ZERO)).toBe(true)
  })

  it('flags the EVM dead/burn address case-insensitively', () => {
    expect(isNullAddress(EVM_DEAD)).toBe(true)
    expect(isNullAddress(EVM_DEAD.toLowerCase())).toBe(true)
    expect(isNullAddress(EVM_DEAD.toUpperCase().replace('0X', '0x'))).toBe(true)
  })

  it('flags the Solana System Program + Incinerator burn addresses', () => {
    expect(isNullAddress(SOL_SYSTEM)).toBe(true)
    expect(isNullAddress(SOL_INCINERATOR)).toBe(true)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isNullAddress(`  ${EVM_ZERO}  `)).toBe(true)
  })

  it('does NOT flag a valid EVM address', () => {
    expect(isNullAddress(VALID_EVM)).toBe(false)
  })

  it('does NOT flag a partial-zero address (0x...0001 is valid)', () => {
    expect(isNullAddress('0x0000000000000000000000000000000000000001')).toBe(false)
  })

  it('does NOT flag empty / non-address strings', () => {
    expect(isNullAddress('')).toBe(false)
    expect(isNullAddress('   ')).toBe(false)
    expect(isNullAddress('not-an-address')).toBe(false)
  })
})

describe('isMalformedEvmAddress', () => {
  it('flags a too-short 0x hex token', () => {
    expect(isMalformedEvmAddress('0xdeadbeef')).toBe(true)
  })

  it('flags a too-long 0x hex token (e.g. 0x + 64 hex)', () => {
    expect(isMalformedEvmAddress(`0x${'a'.repeat(64)}`)).toBe(true)
  })

  it('does NOT flag a valid 42-char EVM address', () => {
    expect(isMalformedEvmAddress(VALID_EVM)).toBe(false)
    expect(isMalformedEvmAddress(EVM_ZERO)).toBe(false)
  })

  it('does NOT flag non-EVM-shaped strings (different address family)', () => {
    expect(isMalformedEvmAddress(SOL_SYSTEM)).toBe(false)
    expect(isMalformedEvmAddress('bc1qxyz')).toBe(false)
    expect(isMalformedEvmAddress('')).toBe(false)
  })

  it('does NOT flag a 0x token with non-hex chars (not an EVM attempt)', () => {
    expect(isMalformedEvmAddress('0xZZZZ')).toBe(false)
  })
})

describe('isSelfSend', () => {
  it('flags from === recipient case-insensitively', () => {
    expect(isSelfSend(VALID_EVM, VALID_EVM.toLowerCase())).toBe(true)
    expect(isSelfSend(`  ${VALID_EVM}  `, VALID_EVM)).toBe(true)
  })

  it('does NOT flag distinct addresses', () => {
    expect(isSelfSend(VALID_EVM, EVM_ZERO)).toBe(false)
  })

  it('does NOT flag when either side is empty', () => {
    expect(isSelfSend('', VALID_EVM)).toBe(false)
    expect(isSelfSend(VALID_EVM, '')).toBe(false)
  })
})

describe('recipientSanity', () => {
  it('flags a null recipient', () => {
    const r = recipientSanity({ recipient: EVM_ZERO })
    expect(r.flagged).toBe(true)
    expect(r.isNull).toBe(true)
    expect(r.flags).toEqual(['null'])
  })

  it('flags a self-send when from === recipient', () => {
    const r = recipientSanity({ from: VALID_EVM, recipient: VALID_EVM.toLowerCase() })
    expect(r.flagged).toBe(true)
    expect(r.isSelfSend).toBe(true)
    expect(r.flags).toEqual(['selfSend'])
  })

  it('flags a malformed EVM recipient', () => {
    const r = recipientSanity({ recipient: '0xdeadbeef' })
    expect(r.flagged).toBe(true)
    expect(r.isMalformedEvm).toBe(true)
    expect(r.flags).toEqual(['malformedEvm'])
  })

  it('returns clean for a valid distinct recipient', () => {
    const r = recipientSanity({ from: EVM_ZERO, recipient: VALID_EVM })
    expect(r.flagged).toBe(false)
    expect(r.flags).toEqual([])
    expect(r.isNull).toBe(false)
    expect(r.isSelfSend).toBe(false)
    expect(r.isMalformedEvm).toBe(false)
  })

  it('can fire multiple flags at once (null EVM-zero self-send)', () => {
    // 0x0 is both the null address AND a self-send when from is also 0x0.
    const r = recipientSanity({ from: EVM_ZERO, recipient: EVM_ZERO })
    expect(r.flags).toEqual(['null', 'selfSend'])
  })

  it('echoes the trimmed recipient', () => {
    const r = recipientSanity({ recipient: `  ${VALID_EVM}  ` })
    expect(r.recipient).toBe(VALID_EVM)
  })

  it('never throws on garbage input', () => {
    expect(() => recipientSanity({ recipient: '🚀💀' })).not.toThrow()
    expect(recipientSanity({ recipient: '🚀💀' }).flagged).toBe(false)
  })
})
