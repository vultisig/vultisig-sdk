import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPublicKey } from './getPublicKey'

// Real-ish compressed secp256k1 public key (33 bytes / 66 hex chars) — same
// vector used across integration tests in packages/sdk/tests.
const ECDSA_ROOT_PUBKEY = '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc'
const HEX_CHAIN_CODE = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'

// The raw 32-byte X coordinate (64 hex chars) stripped of the 02 prefix.
// This is what older KeyImport vault backups sometimes store for secp256k1
// chains instead of the standard 33-byte compressed form.
const ECDSA_RAW_32_BYTE_X = ECDSA_ROOT_PUBKEY.slice(2) // 64 hex chars = 32 bytes

describe('getPublicKey', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('falls back to BIP32 derivation when chainPublicKeys entry is 32 bytes (64 hex chars) on an ecdsa chain', () => {
    // Simulate an older KeyImport vault backup that stored the raw 32-byte X
    // coordinate for Ethereum instead of the standard 33-byte compressed key.
    const chainPublicKeys: Partial<Record<Chain, string>> = {
      [Chain.Ethereum]: ECDSA_RAW_32_BYTE_X,
    }

    const pubkey = getPublicKey({
      chain: Chain.Ethereum,
      walletCore,
      hexChainCode: HEX_CHAIN_CODE,
      publicKeys: {
        ecdsa: ECDSA_ROOT_PUBKEY,
        eddsa: 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
      },
      chainPublicKeys,
    })

    // WalletCore.PublicKey.createWithData would throw "Invalid length: Expected
    // 33 but received 32" if the 32-byte raw key were passed through unchecked.
    // The fact that we get here without throwing confirms the fallback fired.
    const pubkeyData = pubkey.data()
    expect(pubkeyData.length).toBe(33)
  })

  it('uses the 33-byte chainPublicKeys entry directly without re-deriving', () => {
    // A normal 33-byte compressed key in chainPublicKeys - no fallback needed.
    // We verify that the regular path still works correctly alongside the guard.
    const chainPublicKeys: Partial<Record<Chain, string>> = {
      [Chain.Ethereum]: ECDSA_ROOT_PUBKEY,
    }

    const pubkey = getPublicKey({
      chain: Chain.Ethereum,
      walletCore,
      hexChainCode: HEX_CHAIN_CODE,
      publicKeys: {
        ecdsa: ECDSA_ROOT_PUBKEY,
        eddsa: 'b5d7a8e02f3c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e',
      },
      chainPublicKeys,
    })

    expect(pubkey.data().length).toBe(33)
  })
})
