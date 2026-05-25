import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { getPolkadotCoinBalance } from './polkadot'

// A valid Polkadot SS58 address (Alice, network prefix 0).
const VALID_DOT_ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'

describe('getPolkadotCoinBalance — interim token guard (PR A / #562)', () => {
  // PR A adds USDT (id=1984) + USDC (id=1337) to knownTokens.
  // PR B (TBD) will wire pallet_assets.Account queries for those assets.
  // Until PR B lands the resolver must return 0n for any coin with an id
  // rather than returning the native DOT System.Account free balance —
  // which would show the user a misleading DOT balance under a USDT row.

  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('returns 0n for USDT (asset_id=1984) without hitting RPC', async () => {
    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '1984', // TODO(PR B): wire pallet_assets.Account query here
    })

    expect(balance).toBe(0n)
    // RPC must NOT be called — guard must short-circuit before any network I/O
    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('returns 0n for USDC (asset_id=1337) without hitting RPC', async () => {
    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '1337', // TODO(PR B): wire pallet_assets.Account query here
    })

    expect(balance).toBe(0n)
    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('returns 0n for any non-empty id (generic guard coverage)', async () => {
    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '9999',
    })

    expect(balance).toBe(0n)
    expect(queryUrlMock).not.toHaveBeenCalled()
  })
})

describe('getPolkadotCoinBalance — native DOT path (no id)', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('queries RPC for native DOT (no id present)', async () => {
    // SCALE-encoded AccountInfo with free balance = 1_000_000_000_000n (1 DOT)
    // Layout: nonce(u32=0) + consumers(u32=0) + providers(u32=1) + sufficients(u32=0)
    //         + free(u128) + reserved(u128) + frozen(u128) + flags(u128)
    // free = 1_000_000_000_000 = 0x000000E8D4A51000 LE-encoded in 16 bytes:
    //   LE bytes: 00 10 A5 D4 E8 00 00 00 00 00 00 00 00 00 00 00
    // Full hex (nonce+consumers+providers+sufficients = 00000000 00000000 01000000 00000000):
    //   0x 00000000 00000000 01000000 00000000
    //      0010A5D4E8000000000000000000000000  (free, 16 bytes LE)
    //      + 3 more u128 zero fields (reserved, frozen, flags)
    const freeLE = '0010A5D4E8000000000000000000000000'
    const fakeResult =
      '0x' +
      '00000000' + // nonce
      '00000000' + // consumers
      '01000000' + // providers
      '00000000' + // sufficients
      freeLE + // free (16 bytes LE)
      '00000000000000000000000000000000' + // reserved
      '00000000000000000000000000000000' + // frozen
      '00000000000000000000000000000000' // flags

    queryUrlMock.mockResolvedValue({ result: fakeResult })

    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      // no id — native DOT
    })

    // Should have called the RPC
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
    // Balance should be 1 DOT = 1_000_000_000_000 planck
    expect(balance).toBe(1_000_000_000_000n)
  })

  it('returns 0n for a null RPC result (empty account)', async () => {
    queryUrlMock.mockResolvedValue({ result: null })

    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
    })

    expect(balance).toBe(0n)
  })
})
