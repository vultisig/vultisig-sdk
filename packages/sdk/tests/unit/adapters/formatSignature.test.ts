/**
 * Unit Tests for formatSignature Adapter
 *
 * Tests the formatSignature function which converts core KeysignSignature
 * results into SDK Signature format. Handles both single-signature (EVM, Cosmos)
 * and multi-signature (UTXO) cases.
 */

import type { SignatureAlgorithm } from '@core/chain/signing/SignatureAlgorithm'
import type { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'
import { describe, expect, it } from 'vitest'

import { formatSignature } from '../../../src/adapters/formatSignature'

describe('formatSignature', () => {
  describe('Single Signature Cases (EVM, Cosmos, etc.)', () => {
    it('should format ECDSA signature with recovery ID', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xabcd1234': {
          msg: '0xabcd1234',
          r: '0x1234567890abcdef',
          s: '0xfedcba0987654321',
          der_signature: '0x3045022100...',
          recovery_id: '1',
        },
      }
      const messages = ['0xabcd1234']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toEqual({
        signature: '0x3045022100...',
        recovery: 1,
        format: 'ECDSA',
      })
    })

    it('should format ECDSA signature without recovery ID', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xabcd1234': {
          msg: '0xabcd1234',
          r: '0x1234567890abcdef',
          s: '0xfedcba0987654321',
          der_signature: '0x3045022100...',
          // No recovery_id
        },
      }
      const messages = ['0xabcd1234']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toEqual({
        signature: '0x3045022100...',
        recovery: undefined,
        format: 'ECDSA',
      })
    })

    it('should format EdDSA signature as raw r||s (not DER)', () => {
      // EdDSA signatures should store r||s concatenated, not der_signature
      // This is critical for Solana and other EdDSA chains
      const rValue = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const sValue = 'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      const signatureResults: Record<string, KeysignSignature> = {
        '0xabcd1234': {
          msg: '0xabcd1234',
          r: rValue,
          s: sValue,
          der_signature: '0xder_should_not_be_used_for_eddsa',
        },
      }
      const messages = ['0xabcd1234']
      const algorithm: SignatureAlgorithm = 'eddsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      // For EdDSA, signature should be r||s concatenated
      expect(result).toEqual({
        signature: rValue + sValue,
        recovery: undefined,
        format: 'EdDSA',
      })
    })

    it('should strip 0x prefix from EdDSA r and s values before concatenation', () => {
      // When keysign returns r and s with 0x prefixes, they should be stripped
      const rValue = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const sValue = '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      const signatureResults: Record<string, KeysignSignature> = {
        '0xmsg': {
          msg: '0xmsg',
          r: rValue,
          s: sValue,
          der_signature: 'der_unused',
        },
      }
      const messages = ['0xmsg']
      const algorithm: SignatureAlgorithm = 'eddsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      // Should be r||s without 0x prefixes (128 hex chars total)
      expect(result.signature).toBe(
        '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' +
          'fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      )
      expect(result.signature).not.toContain('0x')
      expect(result.signature.length).toBe(128)
    })

    it('should strip uppercase 0X prefix from EdDSA r and s values', () => {
      const rValue = '0X1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const sValue = '0Xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321'
      const signatureResults: Record<string, KeysignSignature> = {
        '0xmsg': {
          msg: '0xmsg',
          r: rValue,
          s: sValue,
          der_signature: 'der_unused',
        },
      }
      const messages = ['0xmsg']
      const algorithm: SignatureAlgorithm = 'eddsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signature).not.toContain('0X')
      expect(result.signature.length).toBe(128)
    })

    it('should format signature with recovery ID "0"', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash1': {
          msg: '0xhash1',
          r: '0xr_value',
          s: '0xs_value',
          der_signature: '0xder_sig',
          recovery_id: '0',
        },
      }
      const messages = ['0xhash1']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toEqual({
        signature: '0xder_sig',
        recovery: 0,
        format: 'ECDSA',
      })
    })

    it('should parse recovery ID from string to number', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash': {
          msg: '0xhash',
          r: '0xr',
          s: '0xs',
          der_signature: '0xder',
          recovery_id: '27',
        },
      }
      const messages = ['0xhash']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.recovery).toBe(27)
      expect(typeof result.recovery).toBe('number')
    })
  })

  describe('Multi-Signature Cases (UTXO Chains)', () => {
    it('should format Bitcoin transaction with 2 inputs', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash1': {
          msg: '0xhash1',
          r: '0xr1',
          s: '0xs1',
          der_signature: '0xder1',
        },
        '0xhash2': {
          msg: '0xhash2',
          r: '0xr2',
          s: '0xs2',
          der_signature: '0xder2',
        },
      }
      const messages = ['0xhash1', '0xhash2']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toEqual({
        signature: '0xder1', // First signature
        recovery: undefined,
        format: 'ECDSA',
        signatures: [
          {
            r: '0xr1',
            s: '0xs1',
            der: '0xder1',
          },
          {
            r: '0xr2',
            s: '0xs2',
            der: '0xder2',
          },
        ],
      })
    })

    it('should format Bitcoin transaction with 3 inputs', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        hash1: {
          msg: 'hash1',
          r: 'r1',
          s: 's1',
          der_signature: 'der1',
        },
        hash2: {
          msg: 'hash2',
          r: 'r2',
          s: 's2',
          der_signature: 'der2',
        },
        hash3: {
          msg: 'hash3',
          r: 'r3',
          s: 's3',
          der_signature: 'der3',
        },
      }
      const messages = ['hash1', 'hash2', 'hash3']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signature).toBe('der1')
      expect(result.format).toBe('ECDSA')
      expect(result.signatures).toHaveLength(3)
      expect(result.signatures).toEqual([
        { r: 'r1', s: 's1', der: 'der1' },
        { r: 'r2', s: 's2', der: 'der2' },
        { r: 'r3', s: 's3', der: 'der3' },
      ])
    })

    it('should maintain order of signatures based on messages array', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg_c: {
          msg: 'msg_c',
          r: 'r_c',
          s: 's_c',
          der_signature: 'der_c',
        },
        msg_a: {
          msg: 'msg_a',
          r: 'r_a',
          s: 's_a',
          der_signature: 'der_a',
        },
        msg_b: {
          msg: 'msg_b',
          r: 'r_b',
          s: 's_b',
          der_signature: 'der_b',
        },
      }
      // Order in messages array should be preserved
      const messages = ['msg_a', 'msg_b', 'msg_c']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signatures).toEqual([
        { r: 'r_a', s: 's_a', der: 'der_a' },
        { r: 'r_b', s: 's_b', der: 'der_b' },
        { r: 'r_c', s: 's_c', der: 'der_c' },
      ])
    })

    it('should include recovery ID in multi-signature if present', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        hash1: {
          msg: 'hash1',
          r: 'r1',
          s: 's1',
          der_signature: 'der1',
          recovery_id: '1',
        },
        hash2: {
          msg: 'hash2',
          r: 'r2',
          s: 's2',
          der_signature: 'der2',
        },
      }
      const messages = ['hash1', 'hash2']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.recovery).toBe(1)
      expect(result.signatures).toHaveLength(2)
    })

    it('should not include signatures array for single message', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash': {
          msg: '0xhash',
          r: '0xr',
          s: '0xs',
          der_signature: '0xder',
        },
      }
      const messages = ['0xhash']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signatures).toBeUndefined()
    })
  })

  describe('Algorithm Mapping', () => {
    it('should map ecdsa to ECDSA format', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = ['msg']

      const result = formatSignature(signatureResults, messages, 'ecdsa')

      expect(result.format).toBe('ECDSA')
    })

    it('should map eddsa to EdDSA format', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = ['msg']

      const result = formatSignature(signatureResults, messages, 'eddsa')

      expect(result.format).toBe('EdDSA')
    })

    it('should throw error for unknown algorithm', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = ['msg']
      const invalidAlgorithm = 'unknown' as SignatureAlgorithm

      expect(() => {
        formatSignature(signatureResults, messages, invalidAlgorithm)
      }).toThrow('Unknown signature algorithm: unknown')
    })
  })

  describe('Error Handling', () => {
    it('should throw error when first message has no signature result', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash2': {
          msg: '0xhash2',
          r: '0xr',
          s: '0xs',
          der_signature: '0xder',
        },
      }
      const messages = ['0xhash1', '0xhash2'] // hash1 not in results
      const algorithm: SignatureAlgorithm = 'ecdsa'

      expect(() => {
        formatSignature(signatureResults, messages, algorithm)
      }).toThrow('No signature result found for first message')
    })

    it('should throw error when signature results are empty', () => {
      const signatureResults: Record<string, KeysignSignature> = {}
      const messages = ['0xhash1']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      expect(() => {
        formatSignature(signatureResults, messages, algorithm)
      }).toThrow('No signature result found for first message')
    })

    it('should throw error when messages array is empty', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0xhash1': {
          msg: '0xhash1',
          r: '0xr',
          s: '0xs',
          der_signature: '0xder',
        },
      }
      const messages: string[] = []
      const algorithm: SignatureAlgorithm = 'ecdsa'

      expect(() => {
        formatSignature(signatureResults, messages, algorithm)
      }).toThrow('No signature result found for first message')
    })

    it('should throw error when multi-signature has missing intermediate signature', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        hash1: {
          msg: 'hash1',
          r: 'r1',
          s: 's1',
          der_signature: 'der1',
        },
        hash3: {
          msg: 'hash3',
          r: 'r3',
          s: 's3',
          der_signature: 'der3',
        },
      }
      const messages = ['hash1', 'hash2', 'hash3'] // hash2 missing
      const algorithm: SignatureAlgorithm = 'ecdsa'

      // Should throw when trying to access missing signature
      expect(() => {
        formatSignature(signatureResults, messages, algorithm)
      }).toThrow()
    })
  })

  describe('Real-World Scenarios', () => {
    it('should format Ethereum transaction signature', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d': {
          msg: '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d',
          r: '0xb2a28f4e7f8e7c7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b',
          s: '0xa3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b',
          der_signature:
            '0x3045022100b2a28f4e7f8e7c7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b0220a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b',
          recovery_id: '1',
        },
      }
      const messages = ['0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.format).toBe('ECDSA')
      expect(result.recovery).toBe(1)
      expect(result.signature).toMatch(/^0x3045/)
      expect(result.signatures).toBeUndefined() // Single signature
    })

    it('should format Bitcoin transaction with multiple UTXOs', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        input0_hash: {
          msg: 'input0_hash',
          r: 'input0_r',
          s: 'input0_s',
          der_signature: 'input0_der',
        },
        input1_hash: {
          msg: 'input1_hash',
          r: 'input1_r',
          s: 'input1_s',
          der_signature: 'input1_der',
        },
        input2_hash: {
          msg: 'input2_hash',
          r: 'input2_r',
          s: 'input2_s',
          der_signature: 'input2_der',
        },
      }
      const messages = ['input0_hash', 'input1_hash', 'input2_hash']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.format).toBe('ECDSA')
      expect(result.signatures).toHaveLength(3)
      expect(result.signature).toBe('input0_der')
    })

    it('should format Solana transaction signature as raw r||s', () => {
      // Solana uses EdDSA which stores r||s concatenated (not DER)
      const signatureResults: Record<string, KeysignSignature> = {
        solana_msg_hash: {
          msg: 'solana_msg_hash',
          r: 'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d',
          s: '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
          der_signature: 'der_should_not_be_used',
        },
      }
      const messages = ['solana_msg_hash']
      const algorithm: SignatureAlgorithm = 'eddsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.format).toBe('EdDSA')
      // EdDSA stores r||s concatenated
      expect(result.signature).toBe(
        'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d' +
          '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e'
      )
      expect(result.recovery).toBeUndefined() // EdDSA doesn't use recovery
    })

    it('should format Cosmos transaction signature', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        cosmos_tx_hash: {
          msg: 'cosmos_tx_hash',
          r: 'cosmos_r',
          s: 'cosmos_s',
          der_signature: 'cosmos_der',
        },
      }
      const messages = ['cosmos_tx_hash']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.format).toBe('ECDSA')
      expect(result.signature).toBe('cosmos_der')
    })
  })

  describe('Type Compatibility', () => {
    it('should return Signature type with all required fields', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = ['msg']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      // Verify all required Signature fields
      expect(result).toHaveProperty('signature')
      expect(result).toHaveProperty('format')
      expect(typeof result.signature).toBe('string')
      expect(typeof result.format).toBe('string')
      expect(['DER', 'ECDSA', 'EdDSA', 'Ed25519']).toContain(result.format)
    })

    it('should have optional recovery field', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
          recovery_id: '1',
        },
      }
      const messages = ['msg']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toHaveProperty('recovery')
      expect(typeof result.recovery).toBe('number')
    })

    it('should have optional signatures array for UTXO', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg1: { msg: 'msg1', r: 'r1', s: 's1', der_signature: 'der1' },
        msg2: { msg: 'msg2', r: 'r2', s: 's2', der_signature: 'der2' },
      }
      const messages = ['msg1', 'msg2']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result).toHaveProperty('signatures')
      expect(Array.isArray(result.signatures)).toBe(true)
      result.signatures?.forEach(sig => {
        expect(sig).toHaveProperty('r')
        expect(sig).toHaveProperty('s')
        expect(sig).toHaveProperty('der')
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long signature strings', () => {
      const longSig = '0x' + 'a'.repeat(1000)
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: longSig,
        },
      }
      const messages = ['msg']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signature).toBe(longSig)
      expect(result.signature.length).toBe(1002)
    })

    it('should handle special characters in message hashes', () => {
      const specialHash = '0x!@#$%^&*()_+-=[]{}|;:,.<>?'
      const signatureResults: Record<string, KeysignSignature> = {
        [specialHash]: {
          msg: specialHash,
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = [specialHash]
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signature).toBe('der')
    })

    it('should handle empty string recovery ID as undefined', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
          recovery_id: '',
        },
      }
      const messages = ['msg']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      // Empty string is falsy, so ternary returns undefined
      expect(result.recovery).toBeUndefined()
    })

    it('should handle non-numeric recovery ID string', () => {
      const signatureResults: Record<string, KeysignSignature> = {
        msg: {
          msg: 'msg',
          r: 'r',
          s: 's',
          der_signature: 'der',
          recovery_id: 'invalid',
        },
      }
      const messages = ['msg']
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      // parseInt('invalid') returns NaN
      expect(result.recovery).toBeNaN()
    })

    it('should handle Unicode in message hashes', () => {
      const unicodeHash = '0x你好世界🌍'
      const signatureResults: Record<string, KeysignSignature> = {
        [unicodeHash]: {
          msg: unicodeHash,
          r: 'r',
          s: 's',
          der_signature: 'der',
        },
      }
      const messages = [unicodeHash]
      const algorithm: SignatureAlgorithm = 'ecdsa'

      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signature).toBe('der')
      expect(result.format).toBe('ECDSA')
    })

    it('should handle large number of UTXO inputs', () => {
      const inputCount = 100
      const signatureResults: Record<string, KeysignSignature> = {}
      const messages: string[] = []

      for (let i = 0; i < inputCount; i++) {
        const hash = `hash_${i}`
        messages.push(hash)
        signatureResults[hash] = {
          msg: hash,
          r: `r_${i}`,
          s: `s_${i}`,
          der_signature: `der_${i}`,
        }
      }

      const algorithm: SignatureAlgorithm = 'ecdsa'
      const result = formatSignature(signatureResults, messages, algorithm)

      expect(result.signatures).toHaveLength(100)
      expect(result.signature).toBe('der_0')
      expect(result.signatures?.[99]).toEqual({
        r: 'r_99',
        s: 's_99',
        der: 'der_99',
      })
    })
  })
})
