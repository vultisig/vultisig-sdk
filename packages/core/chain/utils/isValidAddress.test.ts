import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { Chain } from '../Chain'
import { isValidAddress } from './isValidAddress'

// Real, on-chain verified addresses used throughout these tests.
// Negative examples carry a comment explaining why they are invalid.
const TRON = {
  // Binance hot wallet (network-verified: trongrid returns a real account).
  binance: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
  // Additional known-good T-prefixed base58check address (from existing sdk test).
  known: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8',
  // Invalid: bad sha256d checksum (reported in bead vultisig-qe2ww as Binance, but
  // manual base58check decode shows a 4-byte mismatch — not a real address).
  badChecksum1: 'TDnFuxZweG96YhNQpPL1SY6PaAWSTbU4aE',
  // Invalid: same bad-checksum family from bead report.
  badChecksum2: 'TJDENsfBJs5UP2WmQyQmqnsTLnTpCzQDTt',
  garbage: 'not-a-tron-address',
}

const TON = {
  // Non-bounceable (UQ…) mainnet wallet — from existing jettonTransfer.test.ts.
  nonBounceable: 'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O',
  // Bounceable (EQ…) mainnet wallet — from existing jettonTransfer.test.ts.
  bounceable: 'EQAtiFQ15MZBgpAGwD1jfJm6maz5otBOPefyw9Wc3MVmMgzp',
  // Invalid: bad CRC16 in the base64url payload (reported in bead vultisig-qe2ww,
  // but CRC16/XMODEM recomputation shows a mismatch — not a real address).
  badCrc: 'UQDWkl1TyHZTzhOdhKzOKHnT2gFqKj3e7yKHdCnOQ2LfqHgV',
  garbage: 'not-a-ton-address',
}

const CARDANO = {
  // Shelley base address, mainnet (network nibble = 1), valid bech32 — from
  // existing getKeysignUtxoInfo.test.ts.
  baseMainnet:
    'addr1qx2kd28nq8ac5prwg32hhvudlwggpgfp8utlyqxu6wqgz62f79qsdmm5dsknt9ecr5w468r9ey0fxwkdrwh08ly3tu9sy0f4qd',
  // Enterprise address, mainnet (type nibble = 6, network = 1), valid bech32 —
  // from existing cardano.test.ts.
  enterpriseMainnet: 'addr1vyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpsjpczl2',
  // Invalid: bad bech32 checksum (from bead vultisig-qe2ww; checksum bytes do
  // not produce polymod == 1).
  badBech32: 'addr1q8elqmkuvtyahg2l6pn8w4lhccy6l7nqxq6pv0mn5w7kpn4p6m5r0g2j2r5q5khl0d4m8z5lz2vn0g5phk3cjq0qxg2d3n5c8j',
  // Invalid for mainnet: valid bech32 checksum but network nibble = 0 (testnet).
  // wallet-core correctly rejects testnet addresses on the mainnet coin type.
  testnet: 'addr1vpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5eg0yu80w',
  garbage: 'not-a-cardano-address',
}

// Wallet-core integration tests (require real WalletCore WASM init).
// These pin the exact addresses that must validate so a future wallet-core version
// bump that breaks tron/ton/cardano validation is caught by CI immediately.
describe('isValidAddress — Tron / TON / Cardano (real walletCore)', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  // ── Tron ──────────────────────────────────────────────────────────────────
  describe('Tron', () => {
    it('accepts the Binance hot-wallet T-prefixed base58check address', () => {
      expect(isValidAddress({ chain: Chain.Tron, address: TRON.binance, walletCore })).toBe(true)
    })

    it('accepts a second known-good Tron mainnet address', () => {
      expect(isValidAddress({ chain: Chain.Tron, address: TRON.known, walletCore })).toBe(true)
    })

    it('rejects a Tron-shaped address with a bad sha256d checksum', () => {
      expect(isValidAddress({ chain: Chain.Tron, address: TRON.badChecksum1, walletCore })).toBe(false)
    })

    it('rejects a second Tron-shaped address with a bad sha256d checksum', () => {
      expect(isValidAddress({ chain: Chain.Tron, address: TRON.badChecksum2, walletCore })).toBe(false)
    })

    it('rejects garbage input for Tron', () => {
      expect(isValidAddress({ chain: Chain.Tron, address: TRON.garbage, walletCore })).toBe(false)
    })
  })

  // ── TON ───────────────────────────────────────────────────────────────────
  describe('TON', () => {
    it('accepts a non-bounceable (UQ…) TON mainnet address', () => {
      expect(isValidAddress({ chain: Chain.Ton, address: TON.nonBounceable, walletCore })).toBe(true)
    })

    it('accepts a bounceable (EQ…) TON mainnet address', () => {
      expect(isValidAddress({ chain: Chain.Ton, address: TON.bounceable, walletCore })).toBe(true)
    })

    it('rejects a TON-shaped address with a bad CRC16 in the payload', () => {
      expect(isValidAddress({ chain: Chain.Ton, address: TON.badCrc, walletCore })).toBe(false)
    })

    it('rejects garbage input for TON', () => {
      expect(isValidAddress({ chain: Chain.Ton, address: TON.garbage, walletCore })).toBe(false)
    })
  })

  // ── Cardano ───────────────────────────────────────────────────────────────
  describe('Cardano', () => {
    it('accepts a Shelley base address on mainnet', () => {
      expect(isValidAddress({ chain: Chain.Cardano, address: CARDANO.baseMainnet, walletCore })).toBe(true)
    })

    it('accepts a Shelley enterprise address on mainnet', () => {
      expect(isValidAddress({ chain: Chain.Cardano, address: CARDANO.enterpriseMainnet, walletCore })).toBe(true)
    })

    it('rejects a Cardano address with a bad bech32 checksum', () => {
      expect(isValidAddress({ chain: Chain.Cardano, address: CARDANO.badBech32, walletCore })).toBe(false)
    })

    it('rejects a structurally-valid Cardano testnet address (network nibble ≠ 1)', () => {
      expect(isValidAddress({ chain: Chain.Cardano, address: CARDANO.testnet, walletCore })).toBe(false)
    })

    it('rejects garbage input for Cardano', () => {
      expect(isValidAddress({ chain: Chain.Cardano, address: CARDANO.garbage, walletCore })).toBe(false)
    })
  })
})

describe('isValidAddress for Ripple', () => {
  it('accepts a valid mainnet X-address even when WalletCore only accepts classic addresses', () => {
    const walletCore = {
      CoinType: { xrp: 144 },
      AnyAddress: { isValid: vi.fn(() => false) },
    }

    expect(
      isValidAddress({
        chain: Chain.Ripple,
        address: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2q1qM6owqNbug8W6KV',
        walletCore: walletCore as never,
      })
    ).toBe(true)
  })

  it('accepts a valid tag-zero X-address without falling back to WalletCore', () => {
    const walletCore = {
      CoinType: { xrp: 144 },
      AnyAddress: { isValid: vi.fn(() => true) },
    }

    expect(
      isValidAddress({
        chain: Chain.Ripple,
        address: 'XV5sbjUmgPpvXv4ixFWZ5ptAYZ6PD2m4Er6SnvjVLpMWPjR',
        walletCore: walletCore as never,
      })
    ).toBe(true)
    expect(walletCore.AnyAddress.isValid).not.toHaveBeenCalled()
  })
})
