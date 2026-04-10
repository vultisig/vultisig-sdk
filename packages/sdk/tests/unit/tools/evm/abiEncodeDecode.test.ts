import { describe, expect, it } from 'vitest'

import { abiDecode } from '@/tools/evm/abiDecode'
import { abiEncode } from '@/tools/evm/abiEncode'

describe('abiEncode', () => {
  it('encodes a transfer function call', () => {
    const result = abiEncode('function transfer(address,uint256)', [
      '0x000000000000000000000000000000000000dEaD',
      1000000n,
    ])

    // Should start with transfer selector 0xa9059cbb
    expect(result).toMatch(/^0xa9059cbb/)
    expect(typeof result).toBe('string')
    expect(result.startsWith('0x')).toBe(true)
  })

  it('encodes an approve function call', () => {
    const result = abiEncode('function approve(address,uint256)', [
      '0x000000000000000000000000000000000000dEaD',
      0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
    ])

    // Should start with approve selector 0x095ea7b3
    expect(result).toMatch(/^0x095ea7b3/)
  })

  it('encodes raw parameters without selector', () => {
    const result = abiEncode('address, uint256', ['0x000000000000000000000000000000000000dEaD', 42n])

    // Raw encoding has no 4-byte selector prefix
    expect(result.startsWith('0x')).toBe(true)
    // Should be 64 bytes (32 for address + 32 for uint256) = 128 hex chars + 0x
    expect(result.length).toBe(2 + 128)
  })

  it('throws on invalid function signature', () => {
    expect(() => abiEncode('function ()', [])).toThrow()
  })
})

describe('abiDecode', () => {
  it('decodes a transfer function calldata', () => {
    const encoded = abiEncode('function transfer(address,uint256)', [
      '0x000000000000000000000000000000000000dEaD',
      1000000n,
    ])

    const decoded = abiDecode('function transfer(address,uint256)', encoded)

    expect(decoded).toHaveProperty('functionName', 'transfer')
    expect(decoded).toHaveProperty('args')
    const { args } = decoded as { functionName: string; args: readonly unknown[] }
    expect((args[0] as string).toLowerCase()).toBe('0x000000000000000000000000000000000000dead')
    expect(args[1]).toBe(1000000n)
  })

  it('decodes raw parameters', () => {
    const encoded = abiEncode('address, uint256', ['0x000000000000000000000000000000000000dEaD', 42n])

    const decoded = abiDecode('address, uint256', encoded)

    expect(Array.isArray(decoded)).toBe(true)
    const results = decoded as readonly unknown[]
    expect((results[0] as string).toLowerCase()).toBe('0x000000000000000000000000000000000000dead')
    expect(results[1]).toBe(42n)
  })

  it('round-trips encode/decode for complex types', () => {
    const sig = 'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)'
    const args = [
      1000000n,
      900000n,
      ['0x000000000000000000000000000000000000dEaD', '0x0000000000000000000000000000000000000001'],
      '0x000000000000000000000000000000000000dEaD',
      1700000000n,
    ]

    const encoded = abiEncode(sig, args)
    const decoded = abiDecode(sig, encoded) as { functionName: string; args: readonly unknown[] }

    expect(decoded.functionName).toBe('swapExactTokensForTokens')
    expect(decoded.args[0]).toBe(1000000n)
    expect(decoded.args[1]).toBe(900000n)
    expect(decoded.args[4]).toBe(1700000000n)
  })
})
