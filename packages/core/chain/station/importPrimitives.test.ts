import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { Chain } from '../Chain'
import {
  deriveStationTerraKeyMaterial,
  getStationTerraDerivationPath,
  normalizeStationPrivateKeyHex,
  validateStationPrivateKeyHex,
} from './importPrimitives'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const seedHex =
  '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4'

describe('Station import primitives', () => {
  let walletCore: WalletCore
  const seed = Buffer.from(seedHex, 'hex')

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('derives default Station Terra seed material at account index 0', () => {
    const material = deriveStationTerraKeyMaterial({
      source: {
        kind: 'seed',
        seed,
        coinType: 330,
        index: 0,
      },
      walletCore,
    })

    expect(material).toMatchObject({
      source: 'seed',
      derivePath: "m/44'/330'/0'/0/0",
      account: 0,
      index: 0,
      coinType: 330,
      privateKeyHex: '05be413bb5bd1fb67757251976dd43adf0d4db27d1a5444b4f6ef754ef939b10',
      publicKeyHex: '02acb4bc267db7774614bf6011c59929b006c2554386a3090baff0b3fc418ec044',
      publicKeyBase64: 'Aqy0vCZ9t3dGFL9gEcWZKbAGwlVDhqMJC6/ws/xBjsBE',
      address: 'terra1amdttz2937a3dytmxmkany53pp6ma6dy4vsllv',
    })
  })

  it('derives mnemonic-backed Station material equal to the same BIP39 seed bytes', () => {
    const seedMaterial = deriveStationTerraKeyMaterial({
      source: {
        kind: 'seed',
        seed,
        coinType: 330,
        index: 0,
      },
      walletCore,
    })
    const mnemonicMaterial = deriveStationTerraKeyMaterial({
      source: {
        kind: 'mnemonic',
        mnemonic,
        coinType: 330,
        index: 0,
      },
      walletCore,
    })

    expect(mnemonicMaterial).toEqual({
      ...seedMaterial,
      source: 'mnemonic',
    })
  })

  it('uses the Station account index as the final BIP44 path segment', () => {
    const material = deriveStationTerraKeyMaterial({
      source: {
        kind: 'seed',
        seed,
        coinType: 330,
        index: 7,
      },
      walletCore,
    })

    expect(material).toMatchObject({
      derivePath: "m/44'/330'/0'/0/7",
      privateKeyHex: '40107dac7a5e1a91e6756ce301256edb57de95a79465708a2212b7681c52dd08',
      publicKeyHex: '02923b1b6ae117c5f6f58bdf6403df4b9511bd4d33c7cb8e68ee83833c6aebd126',
      address: 'terra1pye82zpfsmkqj22naq9pfd6e2djypxlq0udryp',
    })
  })

  it('supports legacy Terra coin type 118', () => {
    const material = deriveStationTerraKeyMaterial({
      source: {
        kind: 'seed',
        seed,
        coinType: 118,
        index: 0,
      },
      walletCore,
    })

    expect(material).toMatchObject({
      derivePath: "m/44'/118'/0'/0/0",
      coinType: 118,
      privateKeyHex: 'c4a48e2fce1481cd3294b4490f6678090ea98d3d0e5cd984558ab0968741b104',
      publicKeyHex: '024f4e2ad99c34d60b9ba6283c9431a8418af8673212961f97a77b6377fcd05b62',
      publicKeyBase64: 'Ak9OKtmcNNYLm6YoPJQxqEGK+GcyEpYfl6d7Y3f80Fti',
      address: 'terra19rl4cm2hmr8afy4kldpxz3fka4jguq0a6yhaa4',
    })
  })

  it('validates raw secp256k1 private keys and returns Terra-family public data', () => {
    expect(normalizeStationPrivateKeyHex('  0x' + '01'.padStart(64, '0') + '  ')).toBe(
      '0000000000000000000000000000000000000000000000000000000000000001'
    )
    expect(validateStationPrivateKeyHex('01'.padStart(64, '0'))).toBe(
      '0000000000000000000000000000000000000000000000000000000000000001'
    )

    const material = deriveStationTerraKeyMaterial({
      source: {
        kind: 'privateKey',
        privateKeyHex: '01'.padStart(64, '0'),
      },
      walletCore,
    })

    expect(material).toMatchObject({
      source: 'privateKey',
      privateKeyHex: '0000000000000000000000000000000000000000000000000000000000000001',
      publicKeyHex: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
      publicKeyBase64: 'Anm+Zn753LusVaBilc6HCwcCm/zbLc4o2VnygVsW+BeY',
      address: 'terra1w508d6qejxtdg4y5r3zarvary0c5xw7kued6dc',
    })
    expect(material.chainPublicKeys).toEqual([
      {
        chain: Chain.Terra,
        publicKeyHex: material.publicKeyHex,
        publicKeyBase64: material.publicKeyBase64,
        address: material.address,
        isEddsa: false,
      },
      {
        chain: Chain.TerraClassic,
        publicKeyHex: material.publicKeyHex,
        publicKeyBase64: material.publicKeyBase64,
        address: material.address,
        isEddsa: false,
      },
    ])
  })

  it('rejects invalid private keys and unsupported derivation inputs', () => {
    expect(() => validateStationPrivateKeyHex('not-hex')).toThrow('64 hexadecimal')
    expect(() => validateStationPrivateKeyHex('00'.repeat(32))).toThrow('Invalid secp256k1')
    expect(() => getStationTerraDerivationPath({ coinType: 60 as 330 })).toThrow('Unsupported Station Terra coin type')
    expect(() => getStationTerraDerivationPath({ index: -1 })).toThrow('index must be a non-negative')
  })
})
