import { describe, expect, it } from 'vitest'

import { buildEip2612Permit } from '../buildEip2612Permit'

const BASE_INPUT = {
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  tokenName: 'USD Coin',
  chainId: 1,
  owner: '0xOwner0000000000000000000000000000000000AA',
  spender: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
  value: 1_000_000n,
  nonce: 0n,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
}

describe('buildEip2612Permit', () => {
  it('sets primaryType to Permit', () => {
    const result = buildEip2612Permit(BASE_INPUT)
    expect(result.primaryType).toBe('Permit')
  })

  it('domain has correct fields', () => {
    const result = buildEip2612Permit(BASE_INPUT)
    expect(result.domain.name).toBe('USD Coin')
    expect(result.domain.version).toBe('1')
    expect(result.domain.chainId).toBe(1)
    expect(result.domain.verifyingContract).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  })

  it('includes the EIP-2612 Permit type definition', () => {
    const result = buildEip2612Permit(BASE_INPUT)
    const permitType = result.types.Permit
    const names = permitType.map(f => f.name)
    expect(names).toEqual(['owner', 'spender', 'value', 'nonce', 'deadline'])
    permitType.forEach(f => {
      expect(f.type).toBeDefined()
    })
  })

  it('message maps all fields correctly', () => {
    const result = buildEip2612Permit(BASE_INPUT)
    const msg = result.message
    // addresses are lowercased
    expect(msg.owner).toBe(BASE_INPUT.owner.toLowerCase())
    expect(msg.spender).toBe(BASE_INPUT.spender.toLowerCase())
    expect(msg.value).toBe('1000000')
    expect(msg.nonce).toBe(0n)
    expect(msg.deadline).toBe(BASE_INPUT.deadline)
  })

  it('lowercases owner address', () => {
    const result = buildEip2612Permit({
      ...BASE_INPUT,
      owner: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
    })
    expect(result.message.owner).toBe('0xabcdef0123456789abcdef0123456789abcdef01')
  })

  it('lowercases spender address', () => {
    const result = buildEip2612Permit({
      ...BASE_INPUT,
      spender: '0xDEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF',
    })
    expect(result.message.spender).toBe('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')
  })

  it('serializes value as decimal string', () => {
    const result = buildEip2612Permit({
      ...BASE_INPUT,
      value: 999_999_999_999_999_999n,
    })
    expect(result.message.value).toBe('999999999999999999')
  })

  it('supports nonce > 0', () => {
    const result = buildEip2612Permit({ ...BASE_INPUT, nonce: 42n })
    expect(result.message.nonce).toBe(42n)
  })

  it('verifyingContract matches tokenAddress (not lowercased)', () => {
    // The domain verifyingContract preserves the original casing passed in —
    // some dApps require mixed-case for EIP-55 checksums.
    const result = buildEip2612Permit(BASE_INPUT)
    expect(result.domain.verifyingContract).toBe(BASE_INPUT.tokenAddress)
  })
})
