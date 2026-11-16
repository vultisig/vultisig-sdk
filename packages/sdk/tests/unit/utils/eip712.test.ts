import { TypedDataEncoder } from 'ethers'
import { describe, expect, it } from 'vitest'

import { coerceEip712ChainId, computeEip712Hash, toCanonicalEvmSignature } from '../../../src/utils/eip712'

const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

describe('coerceEip712ChainId', () => {
  it('accepts numeric, decimal, and hex inputs without rounding', () => {
    expect(coerceEip712ChainId(137)).toBe(137)
    expect(coerceEip712ChainId('137')).toBe(137)
    expect(coerceEip712ChainId('0x89')).toBe(137)
    expect(coerceEip712ChainId('9007199254740993')).toBe(9007199254740993n)
  })

  it('rejects empty and malformed inputs', () => {
    expect(() => coerceEip712ChainId('   ')).toThrow('EIP-712 domain.chainId is empty')
    expect(() => coerceEip712ChainId('137.5')).toThrow('EIP-712 domain.chainId not parseable')
  })
})

describe('computeEip712Hash', () => {
  const domain = {
    name: 'ClobAuthDomain',
    version: '1',
    chainId: '137',
  }
  const types = {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    ClobAuth: [
      { name: 'address', type: 'address' },
      { name: 'timestamp', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
  }
  const message = {
    address: '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
    timestamp: '1781158537',
    nonce: 0,
    message: 'This message attests that I control the given wallet',
  }

  it('matches ethers for string chainId payloads and strips explicit EIP712Domain entries', () => {
    const expected = TypedDataEncoder.hash({ ...domain, chainId: 137 }, { ClobAuth: types.ClobAuth }, message)
    expect(computeEip712Hash(domain, types, 'ClobAuth', message)).toBe(expected)
  })
})

describe('toCanonicalEvmSignature', () => {
  const r = '11'.repeat(32)

  it('folds a high-S raw signature into the low half and flips parity', () => {
    const sHigh = ((SECP256K1_N >> 1n) + 7n).toString(16).padStart(64, '0')
    const folded = (SECP256K1_N - BigInt(`0x${sHigh}`)).toString(16).padStart(64, '0')
    expect(toCanonicalEvmSignature(`0x${r}${sHigh}`, 0)).toEqual({ r, s: folded, recovery: 1 })
  })

  it('keeps an already-low-S DER signature unchanged', () => {
    const sLow = '22'.repeat(32)
    const raw = `0x${r}${sLow}`
    expect(toCanonicalEvmSignature(raw, 1)).toEqual({ r, s: sLow, recovery: 1 })
  })
})
