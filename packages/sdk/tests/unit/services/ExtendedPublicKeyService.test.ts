import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'
import { describe, expect, it } from 'vitest'

import { deriveExtendedPublicKey } from '../../../src/vault/services/ExtendedPublicKeyService'

describe('deriveExtendedPublicKey', () => {
  const bip32 = BIP32Factory(ecc)
  const root = bip32.fromSeed(Buffer.alloc(32, 7))
  const expectedAccountTpub =
    'tpubDDdwdfBUrEVKKFDknPxXix8Mo649q1wyjghVxQMXv7tCoGQzgCKi9jLoHX7G8AeJEHH8mKoHRaszQUhcKsJPfLaU1nGKnF5fjF1ZhZvdZ7J'

  it('exports a testnet account tpub using MPC-compatible path normalization', () => {
    expect(
      deriveExtendedPublicKey(Buffer.from(root.publicKey).toString('hex'), Buffer.from(root.chainCode).toString('hex'), {
        derivePath: "m/84'/1'/0'",
        network: 'testnet',
      })
    ).toBe(expectedAccountTpub)
  })

  it('derives the same first receive public key consumed by BitPay', () => {
    const account = bip32.fromBase58(expectedAccountTpub, {
      bech32: 'tb',
      bip32: { public: 0x043587cf, private: 0x04358394 },
      pubKeyHash: 0x6f,
      scriptHash: 0xc4,
      wif: 0xef,
    })

    expect(Buffer.from(account.derive(0).derive(0).publicKey).toString('hex')).toBe(
      '03db7632fff11c1d905314653a4eed9c47464765b15c0350be05028daee0158711'
    )
  })

  it('rejects paths outside the public-child index range', () => {
    expect(() =>
      deriveExtendedPublicKey(Buffer.from(root.publicKey).toString('hex'), Buffer.from(root.chainCode).toString('hex'), {
        derivePath: 'm/2147483648',
        network: 'testnet',
      })
    ).toThrow('Invalid public derivation index')
  })
})
