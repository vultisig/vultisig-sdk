import { Chain } from '@vultisig/core-chain/Chain'
import type { ThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it, vi } from 'vitest'

import { assertNativeSwapReadyForBroadcast } from '../../../../src/vault/services/nativeSwapBroadcastGuard'

const makeInbound = (chain: string, address: string): ThorchainInboundAddress =>
  ({
    address,
    chain,
  }) as ThorchainInboundAddress

const makeThorchainSwapPayload = ({
  vaultAddress = 'bc1qactive',
  expirationTime = 1_700_000_100n,
}: {
  vaultAddress?: string
  expirationTime?: bigint
} = {}): KeysignPayload =>
  ({
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: {
        vaultAddress,
        expirationTime,
      },
    },
  }) as KeysignPayload

const makeMayachainSwapPayload = (expirationTime = 1_700_000_100n): KeysignPayload =>
  ({
    swapPayload: {
      case: 'mayachainSwapPayload',
      value: {
        vaultAddress: 'dash1active',
        expirationTime,
      },
    },
  }) as KeysignPayload

describe('assertNativeSwapReadyForBroadcast', () => {
  it('does nothing for non-swap payloads', async () => {
    const getInboundAddresses = vi.fn()

    await assertNativeSwapReadyForBroadcast({
      chain: Chain.Bitcoin,
      keysignPayload: {} as KeysignPayload,
      getInboundAddresses,
    })

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects expired native swap payloads before fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({
          expirationTime: 1_700_000_000n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_001_000,
      })
    ).rejects.toThrow(/expired/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects native swap payloads with missing expiration before fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({
          expirationTime: 0n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/missing an expiration/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('passes when the MayaChain inbound vault still matches the source chain', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Dash,
        keysignPayload: makeMayachainSwapPayload(),
        getInboundAddresses: async nativeChain => {
          expect(nativeChain).toBe(Chain.MayaChain)
          return [makeInbound('DASH', 'dash1active')]
        },
        now: () => 1_700_000_000_000,
      })
    ).resolves.toBeUndefined()
  })

  it('rejects stale MayaChain inbound vault addresses', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Dash,
        keysignPayload: makeMayachainSwapPayload(),
        getInboundAddresses: async nativeChain => {
          expect(nativeChain).toBe(Chain.MayaChain)
          return [makeInbound('DASH', 'dash1rotated')]
        },
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/MayaChain inbound vault address changed/)
  })

  it('rejects expired Maya native swap payloads before fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.MayaChain,
        keysignPayload: makeMayachainSwapPayload(1_700_000_000n),
        getInboundAddresses,
        now: () => 1_700_000_001_000,
      })
    ).rejects.toThrow(/expired/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects stale THORChain inbound vault addresses', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({
          vaultAddress: 'bc1qold',
        }),
        getInboundAddresses: async () => [makeInbound('BTC', 'bc1qactive')],
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/inbound vault address changed/)
  })

  it('passes when the THORChain inbound vault still matches the source chain', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload(),
        getInboundAddresses: async () => [makeInbound('BTC', 'bc1qactive')],
        now: () => 1_700_000_000_000,
      })
    ).resolves.toBeUndefined()
  })
})
