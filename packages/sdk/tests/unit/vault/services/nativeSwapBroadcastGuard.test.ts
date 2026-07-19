import { Chain } from '@vultisig/core-chain/Chain'
import type { ThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { assertNativeSwapReadyForBroadcast } from '@vultisig/core-mpc/keysign/swap/assertNativeSwapReadyForBroadcast'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { describe, expect, it, vi } from 'vitest'

const makeInbound = (
  chain: string,
  address: string,
  halts: Partial<Pick<ThorchainInboundAddress, 'halted' | 'global_trading_paused' | 'chain_trading_paused'>> = {}
): ThorchainInboundAddress =>
  ({
    address,
    chain,
    halted: false,
    global_trading_paused: false,
    chain_trading_paused: false,
    ...halts,
  }) as ThorchainInboundAddress

const makeThorchainSwapPayload = ({
  vaultAddress = 'bc1qactive',
  expirationTime = 1_700_000_100n,
  toChain,
}: {
  vaultAddress?: string
  expirationTime?: bigint
  toChain?: Chain
} = {}): KeysignPayload =>
  ({
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: {
        vaultAddress,
        expirationTime,
        ...(toChain ? { toCoin: { chain: toChain } } : {}),
      },
    },
  }) as KeysignPayload

const makeMayachainSwapPayload = ({
  vaultAddress = 'dash1active',
  expirationTime = 1_700_000_100n,
}: {
  vaultAddress?: string
  expirationTime?: bigint
} = {}): KeysignPayload =>
  ({
    swapPayload: {
      case: 'mayachainSwapPayload',
      value: {
        vaultAddress,
        expirationTime,
      },
    },
  }) as KeysignPayload

const makeSecuredAssetWithdrawalPayload = ({
  vaultAddress = '',
  memo = 'SECURE-:bc1qdestination',
  expirationTime = 0n,
}: {
  vaultAddress?: string
  memo?: string
  expirationTime?: bigint
} = {}): KeysignPayload =>
  ({
    toAddress: '',
    toAmount: '10000000',
    memo,
    blockchainSpecific: {
      case: 'thorchainSpecific',
      value: { isDeposit: true },
    },
    swapPayload: {
      case: 'thorchainSwapPayload',
      value: {
        vaultAddress,
        routerAddress: '',
        expirationTime,
        fromAmount: '10000000',
        fromCoin: {
          chain: Chain.Bitcoin,
          ticker: 'BTC',
          contractAddress: '',
          decimals: 8,
        },
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
    ).rejects.toThrow(/missing or invalid expiration/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects a native swap payload whose expiration field is absent at runtime', async () => {
    const getInboundAddresses = vi.fn()
    const keysignPayload = makeThorchainSwapPayload()
    if (keysignPayload.swapPayload.case !== 'thorchainSwapPayload') {
      throw new Error('expected THORChain swap payload')
    }
    const native = keysignPayload.swapPayload.value as {
      expirationTime?: bigint
    }
    native.expirationTime = undefined

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload,
        getInboundAddresses,
      })
    ).rejects.toThrow(/missing or invalid expiration/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('allows a secured-asset withdrawal metadata payload without fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.THORChain,
        keysignPayload: makeSecuredAssetWithdrawalPayload(),
        getInboundAddresses,
      })
    ).resolves.toBeUndefined()

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('does not exempt a secure-memo payload that carries an inbound vault', async () => {
    const getInboundAddresses = vi.fn(async nativeChain => {
      expect(nativeChain).toBe(Chain.THORChain)
      return [makeInbound('THOR', 'thor1active')]
    })

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.THORChain,
        keysignPayload: makeSecuredAssetWithdrawalPayload({
          vaultAddress: 'thor1stale',
          memo: 'secure-:bc1qdestination',
          expirationTime: 1_700_000_100n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/inbound vault address changed/)

    expect(getInboundAddresses).toHaveBeenCalledOnce()
  })

  it('does not treat a standard liquidity-withdraw memo as a secured-asset withdrawal', async () => {
    const getInboundAddresses = vi.fn(async nativeChain => {
      expect(nativeChain).toBe(Chain.THORChain)
      return [makeInbound('THOR', 'thor1active')]
    })

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.THORChain,
        keysignPayload: makeSecuredAssetWithdrawalPayload({
          vaultAddress: 'thor1stale',
          memo: '-:BTC.BTC:10000',
          expirationTime: 1_700_000_100n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/inbound vault address changed/)

    expect(getInboundAddresses).toHaveBeenCalledOnce()
  })

  it('rejects expired Maya native swap payloads before fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.MayaChain,
        keysignPayload: makeMayachainSwapPayload({
          expirationTime: 1_700_000_000n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_001_000,
      })
    ).rejects.toThrow(/expired/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects missing Maya native swap expiration before fetching inbound addresses', async () => {
    const getInboundAddresses = vi.fn()

    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Dash,
        keysignPayload: makeMayachainSwapPayload({
          expirationTime: 0n,
        }),
        getInboundAddresses,
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/missing or invalid expiration/)

    expect(getInboundAddresses).not.toHaveBeenCalled()
  })

  it('rejects stale MayaChain inbound vault addresses', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Dash,
        keysignPayload: makeMayachainSwapPayload({
          vaultAddress: 'dash1old',
        }),
        getInboundAddresses: async nativeChain => {
          expect(nativeChain).toBe(Chain.MayaChain)
          return [makeInbound('DASH', 'dash1active')]
        },
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/MayaChain inbound vault address changed/)
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

  it('rejects stale THORChain inbound vault addresses', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({
          vaultAddress: 'bc1qold',
        }),
        getInboundAddresses: async nativeChain => {
          expect(nativeChain).toBe(Chain.THORChain)
          return [makeInbound('BTC', 'bc1qactive')]
        },
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/inbound vault address changed/)
  })

  it('passes when the THORChain inbound vault still matches the source chain', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload(),
        getInboundAddresses: async nativeChain => {
          expect(nativeChain).toBe(Chain.THORChain)
          return [makeInbound('BTC', 'bc1qactive')]
        },
        now: () => 1_700_000_000_000,
      })
    ).resolves.toBeUndefined()
  })

  // sdk#1360: halt re-check at broadcast. Each of the three flags on the SAME inbound object the
  // address check already reads must fail closed - THORChain can halt a chain between quote and
  // broadcast while the vault address stays current, so the address match alone is not sufficient.
  it.each([
    ['halted', { halted: true }],
    ['global_trading_paused', { global_trading_paused: true }],
    ['chain_trading_paused', { chain_trading_paused: true }],
  ] as const)(
    'rejects a THORChain broadcast when %s even if the inbound vault address still matches',
    async (_label, halts) => {
      await expect(
        assertNativeSwapReadyForBroadcast({
          chain: Chain.Bitcoin,
          keysignPayload: makeThorchainSwapPayload({ vaultAddress: 'bc1qactive' }),
          getInboundAddresses: async () => [makeInbound('BTC', 'bc1qactive', halts)],
          now: () => 1_700_000_000_000,
        })
      ).rejects.toThrow(/trading is halted/)
    }
  )

  it('rejects a MayaChain broadcast into a halted source chain', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Dash,
        keysignPayload: makeMayachainSwapPayload({ vaultAddress: 'dash1active' }),
        getInboundAddresses: async () => [makeInbound('DASH', 'dash1active', { halted: true })],
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/trading is halted/)
  })

  // sdk#1360 follow-up: the re-check must mirror quote-time's BOTH-ends evaluation, not just the
  // source. A destination halting between quote and broadcast lets the deposit land while the
  // outbound cannot leave (stuck funds). Source healthy + destination halted must still reject.
  it('rejects a THORChain broadcast when the DESTINATION chain is halted (source healthy)', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({ vaultAddress: 'bc1qactive', toChain: Chain.Solana }),
        getInboundAddresses: async () => [
          makeInbound('BTC', 'bc1qactive'),
          makeInbound('SOL', 'sol1active', { halted: true, chain_trading_paused: true }),
        ],
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/trading is halted for SOL/)
  })

  it('passes when both route ends are healthy (source + destination)', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({ vaultAddress: 'bc1qactive', toChain: Chain.Solana }),
        getInboundAddresses: async () => [makeInbound('BTC', 'bc1qactive'), makeInbound('SOL', 'sol1active')],
        now: () => 1_700_000_000_000,
      })
    ).resolves.toBeUndefined()
  })

  // Tolerance mirrors getNativeSwapTradingHalt: a route leg with no inbound entry (RUNE/CACAO, or a
  // destination absent from the feed) is not haltable here, so it must be skipped, not false-blocked.
  it('does not false-block when the destination has no inbound entry', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({ vaultAddress: 'bc1qactive', toChain: Chain.THORChain }),
        getInboundAddresses: async () => [makeInbound('BTC', 'bc1qactive')],
        now: () => 1_700_000_000_000,
      })
    ).resolves.toBeUndefined()
  })

  it('rejects when global_trading_paused is set on any inbound entry, not only the source', async () => {
    await expect(
      assertNativeSwapReadyForBroadcast({
        chain: Chain.Bitcoin,
        keysignPayload: makeThorchainSwapPayload({ vaultAddress: 'bc1qactive', toChain: Chain.Solana }),
        getInboundAddresses: async () => [
          makeInbound('BTC', 'bc1qactive'),
          makeInbound('SOL', 'sol1active', { global_trading_paused: true }),
        ],
        now: () => 1_700_000_000_000,
      })
    ).rejects.toThrow(/trading is halted/)
  })
})
