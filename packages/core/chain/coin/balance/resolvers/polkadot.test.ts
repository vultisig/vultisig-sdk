import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { getPolkadotCoinBalance } from './polkadot'

// Alice's Polkadot SS58 address (network prefix 0) and its 32-byte public key.
// Public key: d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
const VALID_DOT_ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'

// Storage key verification (computed offline via @polkadot/util-crypto + @noble/hashes):
//
//   twox128("Assets")  = 682a59d51ab9e48a8c8cc418ff9708d2
//   twox128("Account") = b99d880ec681799c0cf30e8886371da9
//   le_u32(1984)       = c0070000
//   blake2_128(le_u32(1984)) = a319d0e87221ca1ee751c1529f201522
//   blake2_128(alice_pubkey) = de1e86a9a8c739864cf3cc5ec2bea59f
//
//   USDT key = 0x682a59d51ab9e48a8c8cc418ff9708d2
//              b99d880ec681799c0cf30e8886371da9
//              a319d0e87221ca1ee751c1529f201522c0070000
//              de1e86a9a8c739864cf3cc5ec2bea59f
//              d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
//   (202 chars total including "0x" prefix)

describe('getPolkadotCoinBalance — pallet_assets.Account (Asset Hub tokens)', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('fetches USDT balance (asset_id=1984) from Asset Hub pallet_assets', async () => {
    // AssetAccount SCALE: balance(u128 LE) + status(Liquid=0x00) + reason(Consumer=0x01)
    // balance = 1_000_000 (1 USDT at 6 decimals) = 0x0F4240
    // LE 16 bytes: 40 42 0f 00 00 00 00 00 00 00 00 00 00 00 00 00
    const fakeAssetAccountHex = '0x' + '40420f00000000000000000000000000' + '00' + '01'
    queryUrlMock.mockResolvedValue({ result: fakeAssetAccountHex })

    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '1984',
    })

    expect(balance).toBe(1_000_000n)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)

    // Verify it called Asset Hub (not relay chain) with the correct storage key.
    const call = queryUrlMock.mock.calls[0]
    const url: string = call[0]
    expect(url).toContain('dot-ah')

    const storageKey: string = call[1].body.params[0]
    // key must start with twox128("Assets") + twox128("Account")
    expect(storageKey.startsWith('0x682a59d51ab9e48a8c8cc418ff9708d2b99d880ec681799c0cf30e8886371da9')).toBe(true)
    // full key for USDT + Alice — verified offline via @polkadot/util-crypto
    expect(storageKey).toBe(
      '0x682a59d51ab9e48a8c8cc418ff9708d2b99d880ec681799c0cf30e8886371da9' +
        'a319d0e87221ca1ee751c1529f201522c0070000' +
        'de1e86a9a8c739864cf3cc5ec2bea59f' +
        'd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d'
    )
    expect(storageKey).toHaveLength(202)
  })

  it('fetches USDC balance (asset_id=1337) from Asset Hub pallet_assets', async () => {
    // balance = 500_000 (0.5 USDC at 6 decimals)
    // 500_000 = 0x7A120, LE 16 bytes: 20 a1 07 00 00...
    const fakeAssetAccountHex = '0x' + '20a10700000000000000000000000000' + '00' + '01'
    queryUrlMock.mockResolvedValue({ result: fakeAssetAccountHex })

    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '1337',
    })

    expect(balance).toBe(500_000n)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)

    // Key must contain le_u32(1337) = 39050000 in the asset segment
    const storageKey: string = queryUrlMock.mock.calls[0][1].body.params[0]
    expect(storageKey).toContain('39050000') // le_u32(1337)
    expect(storageKey).toHaveLength(202)
  })

  it('returns 0n when the account has no entry for that asset (null RPC response)', async () => {
    queryUrlMock.mockResolvedValue({ result: null })

    const balance = await getPolkadotCoinBalance({
      chain: Chain.Polkadot,
      address: VALID_DOT_ADDRESS,
      id: '1984',
    })

    expect(balance).toBe(0n)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)
  })

  it('throws on malformed SCALE response (too short to contain u128)', async () => {
    // 30 hex chars = 15 bytes — not enough for u128 (needs 32 hex chars)
    queryUrlMock.mockResolvedValue({ result: '0x' + 'aa'.repeat(15) })

    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: '1984',
      })
    ).rejects.toThrow(/unexpected storage response/)
  })

  it('throws on non-numeric asset_id', async () => {
    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: 'not-a-number',
      })
    ).rejects.toThrow(/Invalid Polkadot asset_id/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('throws on fractional asset_id (1984.5 would silently truncate with parseInt)', async () => {
    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: '1984.5',
      })
    ).rejects.toThrow(/Invalid Polkadot asset_id/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('throws on asset_id that overflows u32 (4294967296 = 0x100000000)', async () => {
    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: '4294967296',
      })
    ).rejects.toThrow(/Invalid Polkadot asset_id/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('throws on negative asset_id', async () => {
    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: '-1',
      })
    ).rejects.toThrow(/Invalid Polkadot asset_id/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('propagates Asset Hub RPC errors', async () => {
    queryUrlMock.mockResolvedValue({ error: { code: -32000, message: 'storage error' } })

    await expect(
      getPolkadotCoinBalance({
        chain: Chain.Polkadot,
        address: VALID_DOT_ADDRESS,
        id: '1984',
      })
    ).rejects.toThrow(/pallet_assets RPC error/)
  })
})

describe('getPolkadotCoinBalance — native DOT path (no id)', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('queries relay chain RPC for native DOT (no id present)', async () => {
    // SCALE-encoded AccountInfo with free balance = 1_000_000_000_000n (1 DOT)
    // Layout: nonce(u32=0) + consumers(u32=0) + providers(u32=1) + sufficients(u32=0)
    //         + free(u128) + reserved(u128) + frozen(u128) + flags(u128)
    // free = 1_000_000_000_000 = 0x000000E8D4A51000 LE-encoded in 16 bytes:
    //   LE bytes: 00 10 A5 D4 E8 00 00 00 00 00 00 00 00 00 00 00
    const freeLE = '0010a5d4e80000000000000000000000'
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

    expect(queryUrlMock).toHaveBeenCalledTimes(1)

    // Must call the relay chain, not Asset Hub
    const url: string = queryUrlMock.mock.calls[0][0]
    expect(url).not.toContain('dot-ah')
    expect(url).toContain('/dot/')

    // Must use System.Account prefix, not Assets.Account
    const storageKey: string = queryUrlMock.mock.calls[0][1].body.params[0]
    expect(storageKey.startsWith('0x26aa394eea5630e07c48ae0c9558cef7')).toBe(true)

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
