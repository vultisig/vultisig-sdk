import { describe, expect, it } from 'vitest'

import type { Signature } from '../../../../src/types'
import { convertToKeysignSignatures } from '../../../../src/vault/utils/convertSignature'

describe('convertToKeysignSignatures', () => {
  describe('Single signature (ECDSA)', () => {
    it('should convert ECDSA signature with recovery ID', () => {
      const signature: Signature = {
        signature:
          '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
        recovery: 0,
        format: 'ECDSA',
      }
      const messageHashes = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result).toHaveProperty(messageHashes[0])
      expect(result[messageHashes[0]]).toMatchObject({
        msg: messageHashes[0],
        der_signature: signature.signature,
        recovery_id: '0',
      })
      expect(result[messageHashes[0]].r).toBeDefined()
      expect(result[messageHashes[0]].s).toBeDefined()
      expect(result[messageHashes[0]].r).toMatch(/^0x[a-fA-F0-9]+$/)
      expect(result[messageHashes[0]].s).toMatch(/^0x[a-fA-F0-9]+$/)
    })

    it('should convert ECDSA signature without recovery ID', () => {
      const signature: Signature = {
        signature:
          '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
        format: 'ECDSA',
      }
      const messageHashes = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result).toHaveProperty(messageHashes[0])
      expect(result[messageHashes[0]].recovery_id).toBeUndefined()
    })
  })

  describe('Single signature (EdDSA)', () => {
    it('should convert EdDSA signature from raw r||s format', () => {
      // EdDSA signatures are stored as raw r||s (each 32 bytes = 64 hex chars)
      const rValue = 'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d'
      const sValue = '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e'
      const signature: Signature = {
        // Raw format: r||s concatenated (128 hex chars total)
        signature: rValue + sValue,
        format: 'EdDSA',
      }
      const messageHashes = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result).toHaveProperty(messageHashes[0])
      expect(result[messageHashes[0]]).toMatchObject({
        msg: messageHashes[0],
        der_signature: signature.signature,
      })
      // Verify r and s are correctly extracted from raw format
      expect(result[messageHashes[0]].r).toBe('0x' + rValue)
      expect(result[messageHashes[0]].s).toBe('0x' + sValue)
      expect(result[messageHashes[0]].recovery_id).toBeUndefined()
    })

    it('should handle EdDSA signature with 0x prefix', () => {
      const rValue = 'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d'
      const sValue = '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e'
      const signature: Signature = {
        signature: '0x' + rValue + sValue,
        format: 'EdDSA',
      }
      const messageHashes = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result[messageHashes[0]].r).toBe('0x' + rValue)
      expect(result[messageHashes[0]].s).toBe('0x' + sValue)
    })

    it('should preserve EdDSA r,s values through round-trip (regression test for Solana signing)', () => {
      // This test verifies that EdDSA signatures preserve their values
      // through formatSignature -> convertToKeysignSignatures
      // This was the bug: DER encoding/decoding corrupted EdDSA signatures
      const originalR = 'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d'
      const originalS = '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e'

      // Simulate what formatSignature does for EdDSA: stores r||s
      const signature: Signature = {
        signature: originalR + originalS,
        format: 'EdDSA',
      }
      const messageHashes = ['0xmessagehash']

      // Convert back - should get original r,s values
      const result = convertToKeysignSignatures(signature, messageHashes)

      // The r,s values should be exactly what we started with
      expect(result[messageHashes[0]].r).toBe('0x' + originalR)
      expect(result[messageHashes[0]].s).toBe('0x' + originalS)
    })

    it('should throw error for EdDSA signature with invalid length', () => {
      const signature: Signature = {
        signature: 'abc123', // too short - should be 128 hex chars
        format: 'EdDSA',
      }
      const messageHashes = ['0xhash']

      expect(() => convertToKeysignSignatures(signature, messageHashes)).toThrow(
        'Invalid EdDSA signature length: expected 128 hex chars, got 6'
      )
    })

    it('should throw error for EdDSA signature with 0x prefix but invalid length', () => {
      const signature: Signature = {
        signature: '0xabc123', // too short after stripping prefix
        format: 'EdDSA',
      }
      const messageHashes = ['0xhash']

      expect(() => convertToKeysignSignatures(signature, messageHashes)).toThrow(
        'Invalid EdDSA signature length: expected 128 hex chars, got 6'
      )
    })

    it('should handle EdDSA signature with uppercase 0X prefix', () => {
      const rValue = 'ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d'
      const sValue = '7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e'
      const signature: Signature = {
        signature: '0X' + rValue + sValue,
        format: 'EdDSA',
      }
      const messageHashes = ['0xhash']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result[messageHashes[0]].r).toBe('0x' + rValue)
      expect(result[messageHashes[0]].s).toBe('0x' + sValue)
    })
  })

  describe('Multiple signatures (UTXO)', () => {
    it('should convert multiple UTXO signatures', () => {
      const signature: Signature = {
        signature: '', // Not used for multi-sig
        format: 'ECDSA',
        recovery: 0,
        signatures: [
          {
            r: '0xab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d',
            s: '0x7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
            der: '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
          },
          {
            r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            s: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
            der: '0x304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0220fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
          },
        ],
      }
      const messageHashes = [
        '0x1111111111111111111111111111111111111111111111111111111111111111',
        '0x2222222222222222222222222222222222222222222222222222222222222222',
      ]

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(Object.keys(result)).toHaveLength(2)
      expect(result).toHaveProperty(messageHashes[0])
      expect(result).toHaveProperty(messageHashes[1])

      // First signature
      expect(result[messageHashes[0]]).toMatchObject({
        msg: messageHashes[0],
        r: signature.signatures![0].r,
        s: signature.signatures![0].s,
        der_signature: signature.signatures![0].der,
        recovery_id: '0',
      })

      // Second signature
      expect(result[messageHashes[1]]).toMatchObject({
        msg: messageHashes[1],
        r: signature.signatures![1].r,
        s: signature.signatures![1].s,
        der_signature: signature.signatures![1].der,
        recovery_id: '0',
      })
    })
  })

  describe('Error handling', () => {
    it('should throw error when message hash is missing for single signature', () => {
      const signature: Signature = {
        signature:
          '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
        format: 'ECDSA',
      }
      const messageHashes: string[] = []

      expect(() => convertToKeysignSignatures(signature, messageHashes)).toThrow(
        'No message hash provided for signature'
      )
    })

    it('should throw error when message hash is missing for multi-signature', () => {
      const signature: Signature = {
        signature: '',
        format: 'ECDSA',
        signatures: [
          {
            r: '0xab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d',
            s: '0x7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
            der: '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
          },
          {
            r: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            s: '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
            der: '0x304402201234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef0220fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
          },
        ],
      }
      const messageHashes = ['0x1111111111111111111111111111111111111111111111111111111111111111'] // Only 1 hash but 2 signatures

      expect(() => convertToKeysignSignatures(signature, messageHashes)).toThrow(
        'Missing message hash for signature at index 1'
      )
    })
  })
})
