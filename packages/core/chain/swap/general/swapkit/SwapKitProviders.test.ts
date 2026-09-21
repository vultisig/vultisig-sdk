import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit } from '@vultisig/core-chain/swap/general/swapkit/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getSwapKitProviders,
  isSwapKitPairSupported,
  resetSwapKitProvidersCache,
  resolveSwapKitChainMetadata,
} from './SwapKitProviders'

const response = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: vi.fn(async () => body),
  }) as unknown as Response

const BASE_URL = 'https://api.vultisig.com/swapkit-win'

describe('SwapKitProviders', () => {
  beforeEach(() => {
    resetSwapKitProvidersCache()
    configureSwapKit({ apiKey: undefined, baseUrl: BASE_URL })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('isSwapKitPairSupported', () => {
    it('returns true when a single non-excluded provider enables both chains', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response([
            {
              provider: 'NEAR',
              enabledChainIds: ['bitcoincash', '1', 'solana'],
            },
            { provider: 'UNISWAP_V3', enabledChainIds: ['1', '42161'] },
          ])
        )
      )

      // BCH ('bitcoincash') -> ETH ('1') — NEAR enables both. This is the
      // exact issue #3987 pair.
      await expect(isSwapKitPairSupported({ from: Chain.BitcoinCash, to: Chain.Ethereum })).resolves.toBe(true)
    })

    it('returns false when the two chains are split across providers (no single provider has both)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response([
            { provider: 'GARDEN', enabledChainIds: ['bitcoincash'] },
            { provider: 'UNISWAP_V3', enabledChainIds: ['1'] },
          ])
        )
      )

      await expect(isSwapKitPairSupported({ from: Chain.BitcoinCash, to: Chain.Ethereum })).resolves.toBe(false)
    })

    it('ignores excluded native providers when both chains are only enabled there', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response([
            {
              provider: 'MAYACHAIN_STREAMING',
              enabledChainIds: ['zcash', '1'],
            },
            { provider: 'NEAR', enabledChainIds: ['1'] },
          ])
        )
      )

      // Zcash -> ETH only co-enabled on MAYACHAIN_STREAMING, which is filtered out.
      await expect(isSwapKitPairSupported({ from: Chain.Zcash, to: Chain.Ethereum })).resolves.toBe(false)
    })

    it('ignores providers outside the quote allowlist when they are the only provider enabling both chains', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          response([
            { provider: 'UNLISTED_DEX', enabledChainIds: ['bitcoincash', '4663'] },
            { provider: 'NEAR', enabledChainIds: ['bitcoincash'] },
          ])
        )
      )

      await expect(
        isSwapKitPairSupported({
          from: Chain.BitcoinCash,
          to: Chain.Robinhood,
        })
      ).resolves.toBe(false)
    })

    it('fails open (returns true) when the providers snapshot is empty', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response([]))
      )

      await expect(isSwapKitPairSupported({ from: Chain.BitcoinCash, to: Chain.Ethereum })).resolves.toBe(true)
    })

    it('fails open (returns true) when the providers request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response({}, false, 500))
      )

      await expect(isSwapKitPairSupported({ from: Chain.Solana, to: Chain.Ethereum })).resolves.toBe(true)
    })
  })

  describe('getSwapKitProviders', () => {
    it('caches the snapshot and does not refetch on the second call', async () => {
      const fetchMock = vi.fn(async (_url: string) =>
        response([{ provider: 'NEAR', enabledChainIds: ['1', 'solana'] }])
      )
      vi.stubGlobal('fetch', fetchMock)

      await getSwapKitProviders()
      await getSwapKitProviders()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/providers`, expect.any(Object))
    })

    it('returns an empty list (no throw) when the request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network down')
        })
      )

      await expect(getSwapKitProviders()).resolves.toEqual([])
    })

    it('fails open (returns []) when the providers request times out', async () => {
      vi.useFakeTimers()
      // Never resolves on its own; only the abort signal rejects it.
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: { signal?: AbortSignal }) =>
            new Promise<Response>((_, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
            })
        )
      )

      const providersPromise = getSwapKitProviders()
      await vi.advanceTimersByTimeAsync(5_000)

      await expect(providersPromise).resolves.toEqual([])
    })

    it('normalizes the current supportedChainIds response field', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response([{ provider: 'FLASHNET', supportedChainIds: ['4663', '999'] }]))
      )

      await expect(getSwapKitProviders()).resolves.toEqual([{ provider: 'FLASHNET', enabledChainIds: ['4663', '999'] }])
    })
  })

  describe('resolveSwapKitChainMetadata', () => {
    it.each([
      [Chain.Robinhood, '4663', 'HOOD'],
      [Chain.Hyperliquid, '999', 'HYPEREVM'],
    ] as const)('pins the live-confirmed %s identifiers', async (chain, providerChainId, assetPrefix) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(resolveSwapKitChainMetadata(chain)).resolves.toEqual({
        assetPrefix,
        providerChainId,
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('opens an unlisted EVM destination when its canonical id has one unambiguous catalog prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(response([{ provider: 'ONEINCH', enabledChainIds: ['81457'] }]))
          .mockResolvedValueOnce(response({ tokens: [{ chain: 'BLAST', chainId: 81457 }] }))
      )

      await expect(resolveSwapKitChainMetadata(Chain.Blast)).resolves.toEqual({
        assetPrefix: 'BLAST',
        providerChainId: '81457',
      })
    })

    it('skips a dynamic chain when providers disagree about its asset prefix', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            response([
              { provider: 'FLASHNET', enabledChainIds: ['81457'] },
              { provider: 'ONEINCH', enabledChainIds: ['81457'] },
            ])
          )
          .mockResolvedValueOnce(response({ tokens: [{ chain: 'BLAST', chainId: '81457' }] }))
          .mockResolvedValueOnce(response({ tokens: [{ chain: 'BLAST_ALT', chainId: '81457' }] }))
      )

      await expect(resolveSwapKitChainMetadata(Chain.Blast)).resolves.toBeUndefined()
    })

    it('skips a dynamic chain when an advertising provider omits its catalog identity', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            response([
              { provider: 'FLASHNET', enabledChainIds: ['81457'] },
              { provider: 'ONEINCH', enabledChainIds: ['81457'] },
            ])
          )
          .mockResolvedValueOnce(response({ tokens: [{ chain: 'BLAST', chainId: '81457' }] }))
          .mockResolvedValueOnce(response({ tokens: [{ chain: 'ETH', chainId: '1' }] }))
      )

      await expect(resolveSwapKitChainMetadata(Chain.Blast)).resolves.toBeUndefined()
    })

    it('skips only the dynamic chain when any required token catalog is unavailable', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(response([{ provider: 'FLASHNET', enabledChainIds: ['81457'] }]))
          .mockResolvedValueOnce(response({}, false, 503))
      )

      await expect(resolveSwapKitChainMetadata(Chain.Blast)).resolves.toBeUndefined()
    })
  })
})
