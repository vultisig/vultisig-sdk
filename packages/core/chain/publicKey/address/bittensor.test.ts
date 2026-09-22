import { encodeAddress } from '@polkadot/util-crypto'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Buffer } from 'buffer'
import { beforeAll, describe, expect, it } from 'vitest'

import { deriveBittensorAddress } from './bittensor'

let walletCore: WalletCore
beforeAll(async () => {
  walletCore = await initWasm()
})

describe('deriveBittensorAddress', () => {
  it('preserves the SS58-42 Ed25519 vector and round-trips the account bytes', () => {
    const bytes = Buffer.from('8a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c', 'hex')
    const publicKey = walletCore.PublicKey.createWithData(bytes, walletCore.PublicKeyType.ed25519)
    try {
      const result = deriveBittensorAddress({ publicKey, walletCore })
      expect(result).toBe('5FCM8VvFKfKzQnmkT7X9kDY6xMcgeGYRK8tmSbfwpXyM1CvS')
      expect(result).toBe(encodeAddress(bytes, 42))
      const address = walletCore.AnyAddress.createSS58(result, walletCore.CoinType.polkadot, 42)
      try {
        expect(Buffer.from(address.data())).toEqual(bytes)
      } finally {
        address.delete()
      }
    } finally {
      publicKey.delete()
    }
  })

  it('fails clearly when WalletCore cannot derive a valid Ed25519 address', () => {
    const publicKey = walletCore.PublicKey.createWithData(new Uint8Array(32).fill(2), walletCore.PublicKeyType.ed25519)
    try {
      expect(() => deriveBittensorAddress({ publicKey, walletCore })).toThrow(/Bittensor address/)
    } finally {
      publicKey.delete()
    }
  })
})
