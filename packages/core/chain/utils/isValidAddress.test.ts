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

const QBTC = {
  // Two distinct vault addresses, both rejected by the Send form before the
  // explicit bech32 limit was passed (vultisig/vultisig-sdk#2417).
  vaultA: 'qbtc10hmrwslfvxtaaag8rrk3vqr5f5uj7z80z9p9nd',
  vaultB: 'qbtc12tkhjqjqz3uz0r3tm7cmlvdulk4psputeucxhj',
  // vaultA's 20-byte payload re-encoded with other prefixes: valid bech32 that
  // must be rejected on prefix alone.
  cosmosPrefix: 'cosmos10hmrwslfvxtaaag8rrk3vqr5f5uj7z80lzqque',
  thorPrefix: 'thor10hmrwslfvxtaaag8rrk3vqr5f5uj7z80e9emfx',
  // vaultA with its last character changed: bech32 checksum no longer matches.
  badChecksum: 'qbtc10hmrwslfvxtaaag8rrk3vqr5f5uj7z80z9p9nc',
  garbage: 'not-a-qbtc-address',
}

// Wallet-core integration tests (require real WalletCore WASM init).
// These pin the exact addresses that must validate so a future wallet-core version
// bump that breaks tron/ton/cardano validation is caught by CI immediately.
describe('isValidAddress — Tron / TON / Cardano / QBTC (real walletCore)', () => {
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

  // ── QBTC ──────────────────────────────────────────────────────────────────
  // QBTC is validated by decoding bech32 directly (no WalletCore coin type).
  // These pin that a real address passes whichever @scure/base the consumer's
  // lockfile resolves — the decode used to throw under >= 2.3 and every
  // address was rejected.
  describe('QBTC', () => {
    it('accepts a real vault address', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.vaultA, walletCore })).toBe(true)
    })

    it('accepts a second real vault address', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.vaultB, walletCore })).toBe(true)
    })

    it('accepts an address with surrounding whitespace', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: `  ${QBTC.vaultA}\n`, walletCore })).toBe(true)
    })

    it('rejects a cosmos-prefixed bech32 address', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.cosmosPrefix, walletCore })).toBe(false)
    })

    it('rejects a thor-prefixed bech32 address', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.thorPrefix, walletCore })).toBe(false)
    })

    it('rejects a qbtc address with a bad bech32 checksum', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.badChecksum, walletCore })).toBe(false)
    })

    it('rejects garbage input for QBTC', () => {
      expect(isValidAddress({ chain: Chain.QBTC, address: QBTC.garbage, walletCore })).toBe(false)
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

describe('isValidAddress for EVM chains (EIP-55)', () => {
  // EIP-55 reference vectors (checksummed forms from the EIP itself).
  const EVM = {
    checksummed: [
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
      '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
    ],
    // Uniform case carries no checksum and must stay accepted.
    lowercase: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
    uppercase: '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED',
    // Invalid: last letter's case flipped — the checksum no longer matches.
    caseFlipped: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD',
    // Invalid: last hex digit changed with the casing kept (a typo in a
    // checksummed address — the dogfood S8 shape). WalletCore accepts this.
    digitTypo: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAee',
    short: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe',
  }

  // WalletCore must not be consulted for EVM: its `isValid` ignores checksums.
  const permissiveWalletCore = () => ({
    CoinType: { ethereum: 60 },
    AnyAddress: { isValid: vi.fn(() => true) },
  })

  it('accepts correctly checksummed addresses', () => {
    const walletCore = permissiveWalletCore()
    for (const address of EVM.checksummed) {
      expect(
        isValidAddress({
          chain: Chain.Ethereum,
          address,
          walletCore: walletCore as never,
        })
      ).toBe(true)
    }
  })

  it('accepts all-lowercase and all-uppercase addresses', () => {
    const walletCore = permissiveWalletCore()
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: EVM.lowercase,
        walletCore: walletCore as never,
      })
    ).toBe(true)
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: EVM.uppercase,
        walletCore: walletCore as never,
      })
    ).toBe(true)
  })

  it('rejects a mixed-case address whose checksum does not match, without falling back to WalletCore', () => {
    const walletCore = permissiveWalletCore()
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: EVM.caseFlipped,
        walletCore: walletCore as never,
      })
    ).toBe(false)
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: EVM.digitTypo,
        walletCore: walletCore as never,
      })
    ).toBe(false)
    expect(walletCore.AnyAddress.isValid).not.toHaveBeenCalled()
  })

  it('rejects malformed input', () => {
    const walletCore = permissiveWalletCore()
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: EVM.short,
        walletCore: walletCore as never,
      })
    ).toBe(false)
    expect(
      isValidAddress({
        chain: Chain.Ethereum,
        address: '',
        walletCore: walletCore as never,
      })
    ).toBe(false)
  })

  it('applies to every EVM chain, not just Ethereum', () => {
    const walletCore = permissiveWalletCore()
    expect(
      isValidAddress({
        chain: Chain.Base,
        address: EVM.digitTypo,
        walletCore: walletCore as never,
      })
    ).toBe(false)
    expect(
      isValidAddress({
        chain: Chain.Arbitrum,
        address: EVM.checksummed[0],
        walletCore: walletCore as never,
      })
    ).toBe(true)
  })
})
