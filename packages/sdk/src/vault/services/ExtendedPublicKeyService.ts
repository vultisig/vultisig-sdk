import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'

import type { ExtendedPublicKeyOptions } from '../../types'

const NETWORKS = {
  mainnet: {
    bech32: 'bc',
    bip32: { public: 0x0488b21e, private: 0x0488ade4 },
    pubKeyHash: 0x00,
    scriptHash: 0x05,
    wif: 0x80,
  },
  testnet: {
    bech32: 'tb',
    bip32: { public: 0x043587cf, private: 0x04358394 },
    pubKeyHash: 0x6f,
    scriptHash: 0xc4,
    wif: 0xef,
  },
} as const

const parsePublicDerivationPath = (path: string): number[] => {
  if (!path || (path !== 'm' && !path.startsWith('m/'))) {
    throw new Error(`Invalid derivation path: ${path}`)
  }

  return path
    .split('/')
    .slice(1)
    .filter(Boolean)
    .map(segment => {
      // Vultisig's MPC chain-path adapter removes apostrophes before signing.
      // Public derivation must use the identical normalized indexes.
      const normalized = segment.endsWith("'") ? segment.slice(0, -1) : segment
      if (!/^\d+$/.test(normalized)) {
        throw new Error(`Invalid derivation path segment: ${segment}`)
      }
      const index = Number(normalized)
      if (!Number.isSafeInteger(index) || index < 0 || index >= 0x80000000) {
        throw new Error(`Invalid public derivation index: ${segment}`)
      }
      return index
    })
}

/**
 * Derive a serialized ECDSA extended public key using the same normalized
 * public-child path semantics as Vultisig MPC signing.
 */
export const deriveExtendedPublicKey = (
  rootPublicKeyHex: string,
  chainCodeHex: string,
  options: ExtendedPublicKeyOptions
): string => {
  const publicKey = Buffer.from(rootPublicKeyHex, 'hex')
  const chainCode = Buffer.from(chainCodeHex, 'hex')
  if (publicKey.length !== 33) {
    throw new Error('ECDSA root public key must be 33-byte compressed secp256k1')
  }
  if (chainCode.length !== 32) {
    throw new Error('Chain code must be 32 bytes')
  }

  const bip32 = BIP32Factory(ecc)
  let node = bip32.fromPublicKey(publicKey, chainCode, NETWORKS[options.network])
  for (const index of parsePublicDerivationPath(options.derivePath)) {
    node = node.derive(index)
  }
  return node.neutered().toBase58()
}

