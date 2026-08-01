import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: queryUrlMock,
}))

import { getBittensorCoinBalance } from './bittensor'

// Alice's SS58-42 address and its 32-byte public key.
// Public key: d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
const VALID_TAO_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const POLKADOT_ADDRESS_SAME_ACCOUNT = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'

const u128LE = (value: bigint): string => {
  const bytes = Array.from({ length: 16 }, (_, index) =>
    ((value >> BigInt(index * 8)) & 0xffn).toString(16).padStart(2, '0')
  )
  return bytes.join('')
}

const buildSystemAccountHex = (free: bigint): string =>
  '0x' +
  '00000000' + // nonce
  '00000000' + // consumers
  '01000000' + // providers
  '00000000' + // sufficients
  u128LE(free) +
  u128LE(0n) +
  u128LE(0n) +
  u128LE(0n)

describe('getBittensorCoinBalance', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('fetches native TAO balance for a valid Bittensor SS58 address', async () => {
    queryUrlMock.mockResolvedValue({ result: buildSystemAccountHex(1_500_000_000n) })

    const balance = await getBittensorCoinBalance({
      chain: Chain.Bittensor,
      address: VALID_TAO_ADDRESS,
    })

    expect(balance).toBe(1_500_000_000n)
    expect(queryUrlMock).toHaveBeenCalledTimes(1)

    const storageKey: string = queryUrlMock.mock.calls[0][1].body.params[0]
    expect(storageKey.startsWith('0x26aa394eea5630e07c48ae0c9558cef7')).toBe(true)
    expect(storageKey.endsWith('d43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d')).toBe(true)
  })

  it('rejects a Polkadot SS58 address before any RPC call', async () => {
    await expect(
      getBittensorCoinBalance({
        chain: Chain.Bittensor,
        address: POLKADOT_ADDRESS_SAME_ACCOUNT,
      })
    ).rejects.toThrow(/Not a Bittensor address/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('rejects an address with an invalid SS58 checksum before any RPC call', async () => {
    const typoAddress = VALID_TAO_ADDRESS.slice(0, -1) + 'X'

    await expect(
      getBittensorCoinBalance({
        chain: Chain.Bittensor,
        address: typoAddress,
      })
    ).rejects.toThrow(/Invalid SS58 checksum/)

    expect(queryUrlMock).not.toHaveBeenCalled()
  })

  it('returns 0n for a null RPC result', async () => {
    queryUrlMock.mockResolvedValue({ result: null })

    const balance = await getBittensorCoinBalance({
      chain: Chain.Bittensor,
      address: VALID_TAO_ADDRESS,
    })

    expect(balance).toBe(0n)
  })

  it('propagates Bittensor RPC errors', async () => {
    queryUrlMock.mockResolvedValue({ error: { code: -32000, message: 'storage error' } })

    await expect(
      getBittensorCoinBalance({
        chain: Chain.Bittensor,
        address: VALID_TAO_ADDRESS,
      })
    ).rejects.toThrow(/Bittensor balance RPC error/)
  })
})
