import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { encodeErc20Approve, encodeErc20Revoke, MAX_UINT256 } from '@/tools/evm/encodeErc20Approve'

// 1inch v5 router — a real DEX spender, lowercased on purpose to exercise
// the EIP-55 normalization path.
const SPENDER = '0x1111111254eeb25477b68fb85ed929f73a960582'
const SPENDER_CHECKSUM = getAddress(SPENDER)
// approve(address,uint256) selector
const APPROVE_SELECTOR = '0x095ea7b3'

describe('encodeErc20Approve', () => {
  it('encodes an unlimited (MAX_UINT256) approval with the approve selector', () => {
    const data = encodeErc20Approve(SPENDER, MAX_UINT256)

    expect(data.startsWith(APPROVE_SELECTOR)).toBe(true)

    const decoded = decodeFunctionData({ abi: erc20Abi, data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args[0]).toBe(SPENDER_CHECKSUM)
    expect(decoded.args[1]).toBe(MAX_UINT256)
  })

  it('encodes a specific base-unit amount', () => {
    // 100 USDC (6 decimals) = 100_000000 base units
    const data = encodeErc20Approve(SPENDER, 100_000000n)
    const decoded = decodeFunctionData({ abi: erc20Abi, data })
    expect(decoded.args[1]).toBe(100_000000n)
  })

  it('normalizes a lowercased spender to its EIP-55 checksum form', () => {
    const fromLower = encodeErc20Approve(SPENDER, 1n)
    const fromChecksum = encodeErc20Approve(SPENDER_CHECKSUM, 1n)
    // Byte-identical regardless of input casing.
    expect(fromLower).toBe(fromChecksum)
  })

  it('rejects a negative amount', () => {
    expect(() => encodeErc20Approve(SPENDER, -1n)).toThrow(/non-negative/)
  })

  it('rejects an amount exceeding uint256 range', () => {
    expect(() => encodeErc20Approve(SPENDER, MAX_UINT256 + 1n)).toThrow(/uint256 range/)
  })

  it('throws on an invalid spender address', () => {
    expect(() => encodeErc20Approve('0xnotanaddress', 1n)).toThrow()
  })
})

describe('encodeErc20Revoke', () => {
  it('encodes approve(spender, 0)', () => {
    const data = encodeErc20Revoke(SPENDER)

    expect(data.startsWith(APPROVE_SELECTOR)).toBe(true)

    const decoded = decodeFunctionData({ abi: erc20Abi, data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args[0]).toBe(SPENDER_CHECKSUM)
    expect(decoded.args[1]).toBe(0n)
  })

  it('is equivalent to encodeErc20Approve(spender, 0n)', () => {
    expect(encodeErc20Revoke(SPENDER)).toBe(encodeErc20Approve(SPENDER, 0n))
  })
})
