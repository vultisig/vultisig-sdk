import { describe, expect, it } from 'vitest'

import { normalizeToHex } from '../../../src/utils/bytes'

describe('normalizeToHex', () => {
  describe('string input', () => {
    it('should convert hex string without prefix', () => {
      const result = normalizeToHex('abcdef1234')
      expect(result).toBe('abcdef1234')
    })

    it('should convert hex string with 0x prefix', () => {
      const result = normalizeToHex('0xabcdef1234')
      expect(result).toBe('abcdef1234')
    })

    it('should convert uppercase hex to lowercase', () => {
      const result = normalizeToHex('ABCDEF')
      expect(result).toBe('abcdef')
    })

    it('should convert mixed case hex to lowercase', () => {
      const result = normalizeToHex('0xAbCdEf')
      expect(result).toBe('abcdef')
    })

    it('should throw on invalid hex characters', () => {
      expect(() => normalizeToHex('0xGHIJKL')).toThrow('Invalid hex string')
      expect(() => normalizeToHex('ghijkl')).toThrow('Invalid hex string')
      expect(() => normalizeToHex('hello world')).toThrow('Invalid hex string')
    })

    it('should throw on empty string', () => {
      expect(() => normalizeToHex('')).toThrow('Invalid input: empty data')
    })

    it('should throw on 0x only', () => {
      expect(() => normalizeToHex('0x')).toThrow('Invalid input: empty data')
    })

    it('should handle typical 32-byte hash', () => {
      const hash = '0x' + 'a'.repeat(64)
      const result = normalizeToHex(hash)
      expect(result).toBe('a'.repeat(64))
      expect(result.length).toBe(64)
    })
  })

  describe('Uint8Array input', () => {
    it('should convert Uint8Array to hex', () => {
      const bytes = new Uint8Array([0xab, 0xcd, 0xef])
      const result = normalizeToHex(bytes)
      expect(result).toBe('abcdef')
    })

    it('should handle empty Uint8Array', () => {
      const bytes = new Uint8Array([])
      expect(() => normalizeToHex(bytes)).toThrow('Invalid input: empty data')
    })

    it('should handle 32-byte array (typical hash)', () => {
      const bytes = new Uint8Array(32).fill(0xff)
      const result = normalizeToHex(bytes)
      expect(result).toBe('f'.repeat(64))
      expect(result.length).toBe(64)
    })

    it('should preserve leading zeros', () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02])
      const result = normalizeToHex(bytes)
      expect(result).toBe('000102')
    })
  })

  describe('Buffer input', () => {
    it('should convert Buffer to hex', () => {
      const buffer = Buffer.from([0xab, 0xcd, 0xef])
      const result = normalizeToHex(buffer)
      expect(result).toBe('abcdef')
    })

    it('should handle empty Buffer', () => {
      const buffer = Buffer.from([])
      expect(() => normalizeToHex(buffer)).toThrow('Invalid input: empty data')
    })

    it('should handle Buffer from hex string', () => {
      const buffer = Buffer.from('abcdef', 'hex')
      const result = normalizeToHex(buffer)
      expect(result).toBe('abcdef')
    })

    it('should handle 32-byte Buffer (typical hash)', () => {
      const buffer = Buffer.alloc(32, 0xaa)
      const result = normalizeToHex(buffer)
      expect(result).toBe('a'.repeat(64))
    })
  })

  describe('edge cases', () => {
    it('should handle single byte', () => {
      expect(normalizeToHex('ff')).toBe('ff')
      expect(normalizeToHex(new Uint8Array([0xff]))).toBe('ff')
      expect(normalizeToHex(Buffer.from([0xff]))).toBe('ff')
    })

    it('should handle odd-length hex strings', () => {
      // Odd-length hex strings are valid (e.g., "abc" = 0x0abc)
      const result = normalizeToHex('abc')
      expect(result).toBe('abc')
    })

    it('should handle 64-byte array (EdDSA message)', () => {
      const bytes = new Uint8Array(64).fill(0xbb)
      const result = normalizeToHex(bytes)
      expect(result).toBe('b'.repeat(128))
      expect(result.length).toBe(128)
    })
  })
})
