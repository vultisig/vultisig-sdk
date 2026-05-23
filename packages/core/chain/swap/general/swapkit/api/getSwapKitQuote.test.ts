import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit, getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import type { SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

const response = (body: unknown, ok = true, status = 200) =>
  ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: vi.fn(async () => body),
  }) as unknown as Response

type TransferSourceFixture = readonly [string, SwapKitSourceChain, string, number, string, string]

const transferSourceFixtures: TransferSourceFixture[] = [
  ['Bitcoin', Chain.Bitcoin, 'BTC', 8, 'bc1qsource', 'bc1qdeposit'],
  ['Litecoin', Chain.Litecoin, 'LTC', 8, 'ltc1qsource', 'Ldeposit'],
  ['Dogecoin', Chain.Dogecoin, 'DOGE', 8, 'Dsource', 'Ddeposit'],
  ['Bitcoin Cash', Chain.BitcoinCash, 'BCH', 8, 'bitcoincash:qsource', 'bitcoincash:qdeposit'],
  ['Ripple', Chain.Ripple, 'XRP', 6, 'rSource', 'rDeposit'],
  ['Zcash', Chain.Zcash, 'ZEC', 8, 't1Source', 't1Deposit'],
  ['Tron', Chain.Tron, 'TRX', 6, 'TSource', 'TDeposit'],
  ['TON', Chain.Ton, 'TON', 9, 'UQSource', 'UQDeposit'],
]

describe('getSwapKitQuote', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })
  })

  it('quotes and builds an EVM transaction while filtering native THOR/Maya routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'thor-route',
              providers: ['THORCHAIN'],
              expectedBuyAmount: '15',
            },
            {
              routeId: 'near-route',
              providers: ['NEAR'],
              expectedBuyAmount: '12.5',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['NEAR'],
          tx: {
            from: '0xsender',
            to: '0xrouter',
            data: '0xabcdef',
            value: '0',
            gas: '21000',
          },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'ETH',
        decimals: 18,
      },
      to: {
        chain: Chain.Solana,
        address: 'sol-destination',
        ticker: 'USDC',
        id: 'sol-usdc-mint',
        decimals: 6,
      },
      amount: 10_000_000_000_000_000n,
      affiliateBps: 15,
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)

    const quoteBody = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(fetchMock.mock.calls[0][0]).toBe('https://swapkit.example/v3/quote')
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBe('test-key')
    expect(quoteBody).toMatchObject({
      sellAsset: 'ETH.ETH',
      buyAsset: 'SOL.USDC-sol-usdc-mint',
      sellAmount: '0.01',
      affiliateFee: 15,
    })
    expect(quoteBody.sourceAddress).toBeUndefined()
    expect(quoteBody.destinationAddress).toBeUndefined()
    expect(quoteBody.providers).not.toContain('THORCHAIN')
    expect(quoteBody.providers).not.toContain('MAYACHAIN')

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      routeId: 'near-route',
      sourceAddress: '0xsender',
      destinationAddress: 'sol-destination',
      disableBalanceCheck: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).disableBuildTx).toBeUndefined()
    expect(quote).toEqual({
      dstAmount: '12400000',
      provider: 'swapkit',
      routeProvider: 'NEAR',
      tx: {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0xabcdef',
          value: '0',
          gasLimit: 21000n,
        },
      },
    })
  })

  it.each(transferSourceFixtures)(
    'maps %s source routes to a transfer tx and asks SwapKit not to build a tx',
    async (_, chain, ticker, decimals, source, target) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [
              {
                routeId: 'near-transfer-route',
                providers: ['NEAR'],
                expectedBuyAmount: '0.01',
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '0.009',
            providers: ['NEAR'],
            targetAddress: target,
          })
        )

      vi.stubGlobal('fetch', fetchMock)
      configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

      const quote = await getSwapKitQuote({
        from: {
          chain,
          address: source,
          ticker,
          decimals,
        },
        to: {
          chain: Chain.Ethereum,
          address: '0xdestination',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 100_000n,
      })

      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
        routeId: 'near-transfer-route',
        sourceAddress: source,
        destinationAddress: '0xdestination',
        disableBalanceCheck: true,
        disableBuildTx: true,
      })
      expect(quote).toMatchObject({
        dstAmount: '9000000000000000',
        provider: 'swapkit',
        routeProvider: 'NEAR',
        tx: {
          transfer: {
            to: target,
            amount: 100_000n,
          },
        },
      })
    }
  )

  it('maps SwapKit transfer memo and deposit amount fallbacks', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [{ routeId: 'deposit-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }],
          })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '0.009',
            providers: ['NEAR'],
            depositAddress: 'bc1qdeposit',
            depositAmount: '0.001',
            memo: 'swap-memo',
          })
        )
    )
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Bitcoin,
        address: 'bc1qsource',
        ticker: 'BTC',
        decimals: 8,
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xdestination',
        ticker: 'ETH',
        decimals: 18,
      },
      amount: 1n,
    })

    expect(quote.tx).toEqual({
      transfer: {
        to: 'bc1qdeposit',
        amount: 100_000n,
        memo: 'swap-memo',
      },
    })
  })

  it('maps transfer target and decimal amount from SwapKit tx-array fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [{ routeId: 'ton-array-route', providers: ['NEAR'], expectedBuyAmount: '0.01' }],
          })
        )
        .mockResolvedValueOnce(
          response({
            expectedBuyAmount: '0.009',
            providers: ['NEAR'],
            tx: [{ address: 'UQDeposit', amount: '0.001' }],
          })
        )
    )
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Ton,
        address: 'UQSource',
        ticker: 'TON',
        decimals: 9,
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xdestination',
        ticker: 'ETH',
        decimals: 18,
      },
      amount: 1n,
    })

    expect(quote.tx).toEqual({
      transfer: {
        to: 'UQDeposit',
        amount: 1_000_000n,
      },
    })
  })

  it('maps Solana source routes to the existing serialized transaction payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            routes: [
              {
                routeId: 'jupiter-route',
                providers: ['JUPITER'],
                expectedBuyAmount: '0.05',
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          response({
            providers: ['JUPITER'],
            tx: 'serialized-solana-transaction',
            fees: [
              { type: 'network', amount: '0.000005' },
              { type: 'service', amount: '0.000000007' },
            ],
          })
        )
    )
    configureSwapKit({ apiKey: 'test-key' })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Solana,
        address: 'sol-source',
        ticker: 'SOL',
        decimals: 9,
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xdestination',
        ticker: 'ETH',
        decimals: 18,
      },
      amount: 1_000_000n,
    })

    expect(quote).toMatchObject({
      dstAmount: '50000000000000000',
      provider: 'swapkit',
      routeProvider: 'JUPITER',
      tx: {
        solana: {
          data: 'serialized-solana-transaction',
          networkFee: 5000n,
          swapFee: {
            amount: 7n,
            decimals: 9,
            chain: Chain.Solana,
          },
        },
      },
    })
  })

  it('uses the Vultisig proxy without an API key by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'near-route',
              providers: ['NEAR'],
              expectedBuyAmount: '0.01',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.01',
          providers: ['NEAR'],
          tx: {
            to: '0xrouter',
            value: '100',
          },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    // Explicitly set the Windows proxy URL; the default is platform-detected
    // (darwin/ios -> /swapkit, android -> /swapkit-a, other -> /swapkit-win).
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'ETH',
        decimals: 18,
      },
      to: {
        chain: Chain.Bitcoin,
        address: 'bc1destination',
        ticker: 'BTC',
        decimals: 8,
      },
      amount: 1n,
    })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.vultisig.com/swapkit-win/v3/quote')
    expect(fetchMock.mock.calls[0][1].headers['x-api-key']).toBeUndefined()
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.vultisig.com/swapkit-win/v3/swap')
    expect(fetchMock.mock.calls[1][1].headers['x-api-key']).toBeUndefined()
  })

  it('does not let an undefined base URL override the current config', () => {
    configureSwapKit({ baseUrl: 'https://swapkit.example' })
    configureSwapKit({ baseUrl: undefined })

    expect(getSwapKitConfig().baseUrl).toBe('https://swapkit.example')
  })

  it('ranks routes without valid expected buy amounts after valid routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'missing-amount-route',
              providers: ['NEAR'],
            },
            {
              routeId: 'malformed-amount-route',
              providers: ['NEAR'],
              expectedBuyAmount: 'not-a-number',
            },
            {
              routeId: 'valid-route',
              providers: ['NEAR'],
              expectedBuyAmount: '9.4',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '9.3',
          providers: ['NEAR'],
          tx: {
            to: '0xnear-deposit',
            value: '5000000000000000',
          },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'ETH',
        decimals: 18,
      },
      to: {
        chain: Chain.Sui,
        address: '0xsui',
        ticker: 'SUI',
        decimals: 9,
      },
      amount: 5_000_000_000_000_000n,
    })

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).routeId).toBe('valid-route')
  })

  it('throws a below-minimum error when providerErrors carry a minimum-size rejection (no-route response)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response(
        {
          routes: [],
          error: 'noRoutesFound',
          message: 'No routes found for BTC.BTC -> ETH.ETH',
          providerErrors: [
            {
              provider: 'CHAINFLIP',
              message: 'Amount below minimum: 0.0003 BTC required',
              errorCode: 'BELOW_MINIMUM',
            },
          ],
        },
        false,
        400
      )
    )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await expect(
      getSwapKitQuote({
        from: {
          chain: Chain.Bitcoin,
          address: 'bc1qsource',
          ticker: 'BTC',
          decimals: 8,
        },
        to: {
          chain: Chain.Ethereum,
          address: '0xdestination',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 1000n,
      })
    ).rejects.toThrow('CHAINFLIP: Amount below minimum: 0.0003 BTC required')
  })

  it('throws a below-minimum error when providerErrors carry a minimum-size rejection (200 with empty routes)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        routes: [],
        providerErrors: [
          {
            provider: 'NEAR',
            message: 'min amount not met for this swap',
          },
        ],
      })
    )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    await expect(
      getSwapKitQuote({
        from: {
          chain: Chain.Bitcoin,
          address: 'bc1qsource',
          ticker: 'BTC',
          decimals: 8,
        },
        to: {
          chain: Chain.Ethereum,
          address: '0xdestination',
          ticker: 'ETH',
          decimals: 18,
        },
        amount: 100n,
      })
    ).rejects.toThrow('NEAR: min amount not met for this swap')
  })

  it('falls back to focused provider groups when the broad SwapKit provider query misses a route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response({ error: 'noRoutesFound' }, false, 400))
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'near-sui-route',
              providers: ['NEAR'],
              expectedBuyAmount: '9.4',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '9.3',
          providers: ['NEAR'],
          tx: {
            to: '0xnear-deposit',
            value: '5000000000000000',
            gasLimit: '21000',
          },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'ETH',
        decimals: 18,
      },
      to: {
        chain: Chain.Sui,
        address: '0xsui',
        ticker: 'SUI',
        decimals: 9,
      },
      amount: 5_000_000_000_000_000n,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).providers).toContain('CHAINFLIP')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).providers).toEqual(['NEAR'])
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      routeId: 'near-sui-route',
      sourceAddress: '0xsender',
      destinationAddress: '0xsui',
      disableBalanceCheck: true,
    })
    expect(quote).toMatchObject({
      dstAmount: '9300000000',
      provider: 'swapkit',
      routeProvider: 'NEAR',
      tx: {
        evm: {
          to: '0xnear-deposit',
          value: '5000000000000000',
          gasLimit: 21000n,
        },
      },
    })
  })
})
