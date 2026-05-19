import { describe, expect, it } from 'vitest'

import { derivePublicKey } from './derivePublicKey'

const hexRootPubKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const hexChainCode = '0000000000000000000000000000000000000000000000000000000000000000'

describe('derivePublicKey', () => {
  it('rejects apostrophe-marked hardened derivation from an xpub-style public key', () => {
    expect(() =>
      derivePublicKey({
        hexRootPubKey,
        hexChainCode,
        path: "m/44'/0'/0'",
      })
    ).toThrow('Cannot derive hardened child')
  })
})
