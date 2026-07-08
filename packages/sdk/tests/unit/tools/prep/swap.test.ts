import { Chain } from '@vultisig/core-chain/Chain'
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

import { prepareSwapTxFromKeys } from '@/tools/prep/swap'
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

const btcCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1from',
  decimals: 8,
  ticker: 'BTC',
} as any

// A non-expired native quote (expiry is a future unix-seconds timestamp) — the shape that
// exercises the real `'native' in quote` branch without tripping the new expiry guard.
const swapQuoteStub = { quote: { native: { expiry: Math.floor(Date.now() / 1000) + 600 } } } as any

describe('prepareSwapTxFromKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('calls getPublicKey for both fromCoin.chain and toCoin.chain (native swap THORChain -> BTC)', async () => {
    const payload = { __mock: 'nativePayload' }
    mockBuildSwapKeysignPayload.mockResolvedValue(payload)

    const result = await prepareSwapTxFromKeys(baseIdentity, {
      fromCoin: thorCoin,
      toCoin: btcCoin,
      amount: 10,
      swapQuote: swapQuoteStub,
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
      swapQuote: swapQuoteStub,
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
        swapQuote: swapQuoteStub,
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
      swapQuote: swapQuoteStub,
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

describe('prepareSwapTxFromKeys — quote expiry (native only, ABTS/plan 005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('throws on an expired native quote, before building any payload', async () => {
    const expiredQuote = { quote: { native: { expiry: Math.floor(Date.now() / 1000) - 1 } } } as any

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
    const freshQuote = { quote: { native: { expiry: Math.floor(Date.now() / 1000) + 600 } } } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: thorCoin,
        toCoin: btcCoin,
        amount: 10,
        swapQuote: freshQuote,
      })
    ).resolves.toBeDefined()
  })

  it('does NOT enforce expiry on a non-CoW general quote (evm/solana/transfer carry no expiry field here)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const generalQuote = { quote: { general: { tx: { evm: {} } } } } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: generalQuote,
      })
    ).resolves.toBeDefined()
  })

  it('throws on an expired CoW order (validTo in the past), before building any payload', async () => {
    const expiredCowQuote = {
      quote: {
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
    } as any

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
    const freshCowQuote = {
      quote: {
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
    } as any

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

describe('prepareSwapTxFromKeys — amount vs committed sell amount (ABTS/plan 005)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWalletCore.mockResolvedValue(mockWalletCore)
    mockGetPublicKey.mockReturnValueOnce(mockFromPublicKey).mockReturnValueOnce(mockToPublicKey)
  })

  it('does NOT throw for a transfer-route quote even when amount diverges (provider-committed, fee delta allowed)', async () => {
    // transfer.amount is provider-committed and legitimately diverges from caller input (e.g. 100_000 -> 99_999).
    // Exact comparison is excluded for the transfer variant.
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = { quote: { general: { tx: { transfer: { amount: 500000000000000000n } } } } } as any

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
    const quote = {
      quote: {
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
    } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).rejects.toThrow(/does not match the CoW order's committed gross sell amount/)

    expect(mockBuildSwapKeysignPayload).not.toHaveBeenCalled()
  })

  it('builds when the caller amount matches the CoW gross sell amount (sellAmount + feeAmount == requested)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    // gross = 900e15 + 100e15 = 1e18, matches amount '1'
    const quote = {
      quote: {
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
    } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '1',
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('does NOT throw for an EVM-general quote (opaque calldata amount, not confidently comparable)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = { quote: { general: { tx: { evm: { to: '0xrouter', data: '0xdeadbeef', value: '0' } } } } } as any

    await expect(
      prepareSwapTxFromKeys(baseIdentity, {
        fromCoin: ethCoin,
        toCoin: btcCoin,
        amount: '999999', // deliberately absurd — must NOT be rejected, since evm calldata isn't decoded
        swapQuote: quote,
      })
    ).resolves.toBeDefined()
  })

  it('does NOT throw for a native quote (no committed-sell-amount field to compare against)', async () => {
    mockBuildSwapKeysignPayload.mockResolvedValue({ __mock: 'payload' })
    const quote = { quote: { native: { expiry: Math.floor(Date.now() / 1000) + 600 } } } as any

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
    const quote = { quote: { general: { tx: { transfer: { amount: 999n } } } } } as any

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
