import { Chain } from '@vultisig/core-chain/Chain'
import type { ThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it, vi } from 'vitest'

import { assertNativeSwapReadyForBroadcast } from '@/vault/services/nativeSwapBroadcastGuard'

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

  it('checks Maya native swap expiry without fetching THORChain inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await assertNativeSwapReadyForBroadcast({
      chain: Chain.MayaChain,
      keysignPayload: makeMayachainSwapPayload(),
      getInboundAddresses,
      now: () => 1_700_000_000_000,
    })

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
