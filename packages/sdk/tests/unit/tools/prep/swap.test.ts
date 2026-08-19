import { Chain } from '@vultisig/core-chain/Chain'
import { getSwapQuoteSafetyFingerprint } from '@vultisig/core-chain/swap/quote/getSwapQuoteSafetyFingerprint'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildSwapKeysignPayload, mockGetPublicKey, mockGetWalletCore } = vi.hoisted(() => ({
  mockBuildSwapKeysignPayload: vi.fn(),
  mockGetPublicKey: vi.fn(),
  mockGetWalletCore: vi.fn(),
}))

vi.mock('@vultisig/core-mpc/keysign/swap/build', () => ({
  buildSwapKeysignPayload: mockBuildSwapKeysignPayload,
}))
vi.mock('@vultisig/core-chain/publicKey/getPublicKey', () => ({
  getPublicKey: mockGetPublicKey,
}))
vi.mock('@/context/wasmRuntime', () => ({
  getWalletCore: mockGetWalletCore,
}))

import { prepareSwapTxFromKeys, SwapQuoteExpiredError } from '@/tools/prep/swap'
import type { VaultIdentity } from '@/tools/prep/types'

const baseIdentity: VaultIdentity = {
  ecdsaPublicKey: '02ecdsa-public-key',
  eddsaPublicKey: 'eddsa-public-key',
  hexChainCode: 'deadbeef',
  localPartyId: 'iPhone-A1B2',
  libType: 'DKLS',
}

const mockWalletCore = { __mock: 'walletCore' }
const mockFromPublicKey = { __mock: 'fromPublicKey' }
const mockToPublicKey = { __mock: 'toPublicKey' }

const ethCoin = {
  chain: Chain.Ethereum,
  address: '0xfrom',
  decimals: 18,
  ticker: 'ETH',
} as any

const thorCoin = {
  chain: Chain.THORChain,
  address: 'thor1from',
  decimals: 8,
  ticker: 'RUNE',
} as any

const bruneCoin = {
  chain: Chain.THORChain,
  address: 'thor1from',
  id: 'x/brune',
  decimals: 8,
  ticker: 'bRUNE',
} as any

const btcCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1from',
  decimals: 8,
  ticker: 'BTC',
} as any

const bindSwapQuote = (
  quote: any,
  requestedAmount: bigint,
  {
    expiresAt = Date.now() + 600_000,
    fromCoin = ethCoin,
    toCoin = btcCoin,
  }: { expiresAt?: number; fromCoin?: any; toCoin?: any } = {}
) =>
  ({
    quote,
    discounts: [],
    requestedAmount,
    expiresAt,
    safetyFingerprint: getSwapQuoteSafetyFingerprint({
      from: fromCoin,
      to: toCoin,
      requestedAmount,
      expiresAt,
      quote,
    }),
  }) as any

// A non-expired native quote (expiry is a future unix-seconds timestamp) — the shape that
// exercises the real `'native' in quote` branch without tripping the expiry guards.
const freshNativeQuote = (requestedAmount: bigint, fromCoin = ethCoin, toCoin = btcCoin) =>
  bindSwapQuote({ native: { expiry: Math.floor(Date.now() / 1000) + 600 } }, requestedAmount, { fromCoin, toCoin })

describe('prepareSwapTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('calls getPublicKey for both fromCoin.chain and toCoin.chain (native swap THORChain -> BTC)', async () => {
    const payload = { __mock: 'nativePayload' }
    const swapQuote = freshNativeQuote(1_000_000_000n, thorCoin, btcCoin)
    mockBuildSwapKeysignPayload.mockResolvedValue(payload)

    const result = await prepareSwapTxFromKeys(baseIdentity, {
      fromCoin: thorCoin,
      toCoin: btcCoin,
      amount: 10,
      swapQuote,
    })

    expect(result).toBe(payload)

    expect(mockGetPublicKey).toHaveBeenCalledTimes(2)
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(1, {
      chain: Chain.THORChain,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(2, {
      chain: Chain.Bitcoin,
      walletCore: mockWalletCore,
      publicKeys: {
        ecdsa: baseIdentity.ecdsaPublicKey,
        eddsa: baseIdentity.eddsaPublicKey,
      },
      hexChainCode: baseIdentity.hexChainCode,
    })

    expect(mockBuildSwapKeysignPayload).toHaveBeenCalledTimes(1)
    const call = mockBuildSwapKeysignPayload.mock.calls[0][0]
    expect(call).toMatchObject({
      fromCoin: thorCoin,
      toCoin: btcCoin,
      amount: 10,
      swapQuote,
      vaultId: baseIdentity.ecdsaPublicKey,
      localPartyId: baseIdentity.localPartyId,
      libType: baseIdentity.libType,
      fromPublicKey: mockFromPublicKey,
      toPublicKey: mockToPublicKey,
      walletCore: mockWalletCore,
    })
  })

  it('uses the explicit walletCore override and does not call the global getWalletCore', async () => {
    const overrideWalletCore = { __mock: 'override-walletCore' }
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })

    await prepareSwapTxFromKeys(
      baseIdentity,
      {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: freshNativeQuote(1_000_000_000_000_000_000n),
      },
      overrideWalletCore as any
    )

    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockBuildSwapKeysignPayload.mock.calls[0][0].walletCore).toBe(overrideWalletCore)
  })

  it('forwards chainPublicKeys to getPublicKey for both fromCoin and toCoin (seedphrase-imported vault)', async () => {
    const identity: VaultIdentity = {
      ...baseIdentity,
      chainPublicKeys: {
        [Chain.Ethereum]: '03eth-per-chain',
        [Chain.Bitcoin]: '03btc-per-chain',
      },
    }
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })

    await prepareSwapTxFromKeys(identity, {
      fromCoin: ethCoin,
      toCoin: btcCoin,
      amount: '1',
      swapQuote: freshNativeQuote(1_000_000_000_000_000_000n),
    })

    expect(mockGetPublicKey).toHaveBeenCalledTimes(2)
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chain: Chain.Ethereum,
        chainPublicKeys: identity.chainPublicKeys,
      })
    )
    expect(mockGetPublicKey).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chain: Chain.Bitcoin,
        chainPublicKeys: identity.chainPublicKeys,
      })
    )
  })
})

describe('prepareSwapTxFromKeys — quote expiry (ABTS/plan 005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('throws on an expired native quote, before building any payload', async () => {
    const expiredQuote = bindSwapQuote({ native: { expiry: Math.floor(Date.now() / 1000) - 1 } }, 1_000_000_000n, {
      fromCoin: thorCoin,
      toCoin: btcCoin,
    })

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: btcCoin,
        amount: 10,
        swapQuote: expiredQuote,
      })
    ).rejects.toThrow(/expired/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    // The expiry check must fire BEFORE any wallet-core / public-key derivation side effect.
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('does NOT throw on a fresh native quote (expiry in the future)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const freshQuote = freshNativeQuote(1_000_000_000n, thorCoin, btcCoin)

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: btcCoin,
        amount: 10,
        swapQuote: freshQuote,
      })
    ).resolves.toBeDefined()
  })

  it('throws on an expired EVM-general quote before building any payload', async () => {
    const generalQuote = bindSwapQuote({ general: { tx: { evm: {} } } }, 1_000_000_000_000_000_000n, {
      expiresAt: Date.now() - 1,
    })

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: generalQuote,
      })
    ).rejects.toBeInstanceOf(SwapQuoteExpiredError)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('throws on an expired CoW order (validTo in the past), before building any payload', async () => {
    const expiredCowQuote = bindSwapQuote(
      {
        general: {
          tx: {
            cowswap_order: {
              sellAmount: '1000000000000000000',
              feeAmount: '0',
              validTo: Math.floor(Date.now() / 1000) - 1,
            },
          },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: expiredCowQuote,
      })
    ).rejects.toThrow(/expired/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
  })

  it('does NOT throw on a fresh CoW order (validTo in the future)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const freshCowQuote = bindSwapQuote(
      {
        general: {
          tx: {
            cowswap_order: {
              sellAmount: '1000000000000000000',
              feeAmount: '0',
              validTo: Math.floor(Date.now() / 1000) + 600,
            },
          },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: freshCowQuote,
      })
    ).resolves.toBeDefined()
  })
})

describe('prepareSwapTxFromKeys — amount consistency (ABTS/plan 005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('does NOT throw for a transfer-route quote even when amount diverges (provider-committed, fee delta allowed)', async () => {
    // transfer.amount is provider-committed and legitimately diverges from caller input (e.g. 100_000 -> 99_999).
    // Exact comparison is excluded for the transfer variant.
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = bindSwapQuote(
      { general: { tx: { transfer: { amount: 500000000000000000n } } } },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('throws when the caller amount does not match the CoW gross sell amount (sellAmount + feeAmount)', async () => {
    // gross = 600e15 + 100e15 = 700e15, but requested is 1e18 — mismatch
    const quote = bindSwapQuote(
      {
        general: {
          tx: {
            cowswap_order: {
              sellAmount: '600000000000000000',
              feeAmount: '100000000000000000',
              validTo: Math.floor(Date.now() / 1000) + 600,
            },
          },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the route's committed source amount/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
  })

  it('builds when the caller amount matches the CoW gross sell amount (sellAmount + feeAmount == requested)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    // gross = 900e15 + 100e15 = 1e18, matches amount '1'
    const quote = bindSwapQuote(
      {
        general: {
          tx: {
            cowswap_order: {
              sellAmount: '900000000000000000',
              feeAmount: '100000000000000000',
              validTo: Math.floor(Date.now() / 1000) + 600,
            },
          },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('throws when RUJI Trade CosmWasm funds do not match the bound source amount', async () => {
    const quote = bindSwapQuote(
      {
        general: {
          tx: {
            cosmosWasm: {
              sender: thorCoin.address,
              contract: 'thor1contract',
              executeMsg: '{"swap":{}}',
              funds: [{ denom: 'rune', amount: '99999999' }],
            },
          },
        },
      },
      100_000_000n,
      { fromCoin: thorCoin, toCoin: bruneCoin }
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: bruneCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the route's committed source amount/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
  })

  it('builds when RUJI Trade CosmWasm funds match the bound source amount', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = bindSwapQuote(
      {
        general: {
          tx: {
            cosmosWasm: {
              sender: thorCoin.address,
              contract: 'thor1contract',
              executeMsg: '{"swap":{}}',
              funds: [{ denom: 'rune', amount: '100000000' }],
            },
          },
        },
      },
      100_000_000n,
      { fromCoin: thorCoin, toCoin: bruneCoin }
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: bruneCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('rejects a RUJI Trade CosmWasm route without exactly one positive source fund', async () => {
    const quote = bindSwapQuote(
      {
        general: {
          tx: {
            cosmosWasm: {
              sender: thorCoin.address,
              contract: 'thor1contract',
              executeMsg: '{"swap":{}}',
              funds: [],
            },
          },
        },
      },
      100_000_000n,
      { fromCoin: thorCoin, toCoin: bruneCoin }
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: bruneCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/exactly one positive integer source fund/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
  })

  it('throws when an EVM-general quote was fetched for a different source amount', async () => {
    const quote = bindSwapQuote(
      {
        general: {
          tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '999999',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the quote's requested source amount/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('builds an EVM-general quote when the bound source amount matches', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = bindSwapQuote(
      {
        general: {
          tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('rejects a same-amount quote bound to a different coin pair before wallet work', async () => {
    const quote = bindSwapQuote(
      {
        general: {
          tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } },
        },
      },
      1_000_000_000_000_000_000n
    )

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: { ...btcCoin, id: 'other-bitcoin-asset' },
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the requested coins, amount, value types, or original transaction/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('rejects a quote whose EVM transaction changed after binding before wallet work', async () => {
    const quote = bindSwapQuote(
      {
        general: {
          tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } },
        },
      },
      1_000_000_000_000_000_000n
    )
    quote.quote.general.tx.evm.data = '0xchanged'

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the requested coins, amount, value types, or original transaction/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('uses the validated snapshot when caller-owned quote inputs mutate during wallet resolution', async () => {
    let resolveWalletCore!: (walletCore: typeof mockWalletCore) => void
    mockGetWalletCore.mockReturnValue(
      new Promise<typeof mockWalletCore>(resolve => {
        resolveWalletCore = resolve
      })
    )
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })

    const quote = bindSwapQuote(
      { general: { tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } } } },
      1_000_000_000_000_000_000n
    )
    const params = {
      fromCoin: ethCoin,
      toCoin: { ...btcCoin },
      amount: '1',
      swapQuote: quote,
    }

    const pending = prepareSwapTxFromKeys(baseIdentity, params)
    params.toCoin.id = 'mutated-asset'
    quote.quote.general.tx.evm.data = '0xchanged-during-await'
    resolveWalletCore(mockWalletCore)

    await expect(pending).resolves.toBeDefined()
    expect(mockBuildSwapKeysignPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        toCoin: expect.not.objectContaining({ id: 'mutated-asset' }),
        swapQuote: expect.objectContaining({
          quote: {
            general: expect.objectContaining({
              tx: { evm: expect.objectContaining({ data: '0xdeadbeef' }) },
            }),
          },
        }),
      })
    )
  })

  it('fails closed when an EVM-general quote lacks its safety binding', async () => {
    const quote = {
      quote: {
        general: {
          tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } },
        },
      },
    } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/missing its amount\/expiry safety binding/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
    expect(mockGetWalletCore).not.toHaveBeenCalled()
    expect(mockGetPublicKey).not.toHaveBeenCalled()
  })

  it('does NOT throw for a native quote (no committed-sell-amount field to compare against)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = freshNativeQuote(99_999_900_000_000n, thorCoin, btcCoin)

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: btcCoin,
        amount: '999999',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('accepts a scientific-notation amount on a transfer-route quote (transfer excluded from amount check)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    // "1e-8" @ 8 decimals == 1 base unit — transfer is excluded, so this should never throw.
    const quote = bindSwapQuote({ general: { tx: { transfer: { amount: 999n } } } }, 1n, {
      fromCoin: btcCoin,
      toCoin: ethCoin,
    })

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: btcCoin,
        toCoin: ethCoin,
        amount: '1e-8',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })
})
