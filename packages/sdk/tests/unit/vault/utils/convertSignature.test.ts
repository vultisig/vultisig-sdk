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
    it('should convert EdDSA signature', () => {
      const signature: Signature = {
        signature:
          '0x3045022100ab3c7b6a9e8f2c1d5e4a3f2b1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d02207f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e',
        format: 'EdDSA',
      }
      const messageHashes = ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef']

      const result = convertToKeysignSignatures(signature, messageHashes)

      expect(result).toHaveProperty(messageHashes[0])
      expect(result[messageHashes[0]]).toMatchObject({
        msg: messageHashes[0],
        der_signature: signature.signature,
      })
      expect(result[messageHashes[0]].recovery_id).toBeUndefined()
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
