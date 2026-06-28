import { Chain } from '@vultisig/core-chain/Chain'
import { configureSwapKit, getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import type { SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import {
  SwapKitAmountBelowMinimumError,
  SwapKitNoEligibleRoutesError,
} from '@vultisig/core-chain/swap/general/swapkit/SwapKitErrors'
import { resetSwapKitProvidersCache } from '@vultisig/core-chain/swap/general/swapkit/SwapKitProviders'
import { networks, payments, Psbt } from 'bitcoinjs-lib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSwapKitQuote } from './getSwapKitQuote'

const response = (body: unknown, ok = true, status = 200) => {
  const serialized = JSON.stringify(body)
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    text: vi.fn(async () => serialized),
    json: vi.fn(async () => body),
  } as unknown as Response
}

const textEncoder = new TextEncoder()
const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const BTC_RECIPIENT_ADDRESS = 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'

const makeBitcoinPsbtPayload = (outputValue: bigint) => {
  const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
  const psbt = new Psbt({ network: networks.bitcoin })

  psbt.addInput({
    hash: 'aa'.repeat(32),
    index: 0,
    witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 110_000n },
  })
  psbt.addOutput({
    address: BTC_RECIPIENT_ADDRESS,
    value: outputValue,
  })

  return {
    sourceAddress: p2wpkh.address!,
    targetAddress: BTC_RECIPIENT_ADDRESS,
    payload: psbt.toBuffer(),
  }
}

type TransferSourceFixture = readonly [string, SwapKitSourceChain, string, number, string, string]

const transferSourceFixtures: TransferSourceFixture[] = [
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
    configureSwapKit({
      apiKey: undefined,
      baseUrl: 'https://api.vultisig.com/swapkit-win',
    })
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
    configureSwapKit({
      apiKey: 'test-key',
      baseUrl: 'https://swapkit.example',
    })

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
      configureSwapKit({
        apiKey: 'test-key',
        baseUrl: 'https://swapkit.example',
      })

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
            routes: [
              {
                routeId: 'deposit-route',
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

  it('maps SwapKit transfer tx metadata into QR payload fields', async () => {
    const psbt = makeBitcoinPsbtPayload(99_999n)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'psbt-route',
              providers: ['CHAINFLIP'],
              expectedBuyAmount: '0.01',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.009',
          providers: ['CHAINFLIP'],
          targetAddress: psbt.targetAddress,
          inboundAddress: 'bc1qinbound',
          depositAmount: '0.001',
          tx: Buffer.from(psbt.payload).toString('base64'),
          meta: {
            txType: 'PSBT',
          },
          swapId: 'swapkit-id',
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Bitcoin,
        address: psbt.sourceAddress,
        ticker: 'BTC',
        decimals: 8,
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
      routeId: 'psbt-route',
      sourceAddress: psbt.sourceAddress,
      destinationAddress: '0xdestination',
      disableBalanceCheck: true,
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).disableBuildTx).toBeUndefined()
    expect(quote.tx).toEqual({
      transfer: {
        to: psbt.targetAddress,
        amount: 99_999n,
        txType: 'PSBT',
        txPayload: psbt.payload,
        inboundAddress: 'bc1qinbound',
        swapId: 'swapkit-id',
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
            routes: [
              {
                routeId: 'ton-array-route',
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
        txPayload: textEncoder.encode('[{"address":"UQDeposit","amount":"0.001"}]'),
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
    configureSwapKit({
      apiKey: undefined,
      baseUrl: 'https://api.vultisig.com/swapkit-win',
    })

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

  it('returns a valid route when providerErrors carry below-minimum alongside valid routes (no UX regression)', async () => {
    // Updated #535 r3 (NeO preferably-blocking): when SwapKit returns a usable
    // route AND a below-minimum providerError, we MUST return the route. The
    // earlier behavior (throwing the providerError) blocked users from a
    // route they could otherwise execute. Below-min surfacing is now gated
    // on `allowedRoutes.length === 0`. EVM→Sui path so we can reuse the
    // existing NEAR-route mock shape (UTXO source would need different
    // tx envelope structure).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [
            {
              routeId: 'near-route',
              providers: ['NEAR'],
              expectedBuyAmount: '9.4',
            },
          ],
          providerErrors: [
            {
              provider: 'CHAINFLIP',
              message: 'Amount below minimum: 0.0003 BTC required',
              errorCode: 'BELOW_MINIMUM',
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        // Second call: route-detail fetch for the selected NEAR route.
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

    // Must NOT throw — the NEAR route is valid and should be returned even
    // though CHAINFLIP rejected for below-minimum.
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

    expect(quote).toMatchObject({
      provider: 'swapkit',
      routeProvider: 'NEAR',
    })
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

  it('reclassifies noRoutesFound to an amount-below-minimum error when the pair is structurally supported (#4418)', async () => {
    resetSwapKitProvidersCache()
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/providers')) {
        return response([{ provider: 'NEAR', enabledChainIds: ['bitcoincash', '1'] }])
      }
      return response({ error: 'noRoutesFound', message: 'No routes found for BCH.BCH -> ETH.ETH' }, false, 404)
    })

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    // The issue #3987 pair: BCH -> ETH at a below-minimum amount. SwapKit only
    // returns noRoutesFound (no providerErrors), but NEAR structurally supports
    // the pair, so we surface an actionable amount error instead of "no route".
    await expect(
      getSwapKitQuote({
        from: { chain: Chain.BitcoinCash, address: 'bitcoincash:qsource', ticker: 'BCH', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1_150_000n,
      })
    ).rejects.toBeInstanceOf(SwapKitAmountBelowMinimumError)
  })

  it('rethrows the no-eligible-routes error when the pair is not structurally supported', async () => {
    resetSwapKitProvidersCache()
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.endsWith('/providers')) {
        // No provider co-enables litecoin + ETH, so the pair is genuinely unsupported.
        return response([{ provider: 'NEAR', enabledChainIds: ['1', 'solana'] }])
      }
      return response({ error: 'noRoutesFound' }, false, 404)
    })

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: undefined, baseUrl: 'https://api.vultisig.com/swapkit-win' })

    await expect(
      getSwapKitQuote({
        from: { chain: Chain.Litecoin, address: 'ltc1qsource', ticker: 'LTC', decimals: 8 },
        to: { chain: Chain.Ethereum, address: '0xdestination', ticker: 'ETH', decimals: 18 },
        amount: 1000n,
      })
    ).rejects.toBeInstanceOf(SwapKitNoEligibleRoutesError)
  })

  // Inner-spender fix: SwapKit `/v3/swap` returns a top-level `approvalTx` whose
  // approve() spender is the route's INNER executor (e.g. the 1inch executor
  // 0x6c0ad82f…), NOT the outer Diamond router. Approving only the router
  // reverts "transfer amount exceeds allowance". We decode that spender and
  // surface it as evm.approvalAddress so the approve leg targets it.
  // On-chain proof: USDC→ETH tx 0xa3aadf17 (approve spender 0x6c0ad82f…).
  it('threads the approvalTx approve() spender onto evm.approvalAddress', async () => {
    // approve(0x6c0ad82f9721a6dc986381d19338601a2e6370e5, amount)
    const innerExecutor = '0x6c0ad82f9721a6dc986381d19338601a2e6370e5'
    const approveData =
      '0x095ea7b3' +
      '000000000000000000000000' +
      innerExecutor.slice(2) +
      'f'.repeat(64)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [{ routeId: 'one-inch-route', providers: ['ONEINCH'], expectedBuyAmount: '0.3' }],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '0.3',
          providers: ['ONEINCH'],
          tx: { from: '0xsender', to: '0x9025b8ff', data: '0xda5d4170', value: '0', gas: '210000' },
          approvalTx: {
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            data: approveData,
          },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        ticker: 'USDC',
        id: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        decimals: 6,
      },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      amount: 1_000_000n,
    })

    expect(quote.tx).toMatchObject({
      evm: { to: '0x9025b8ff', approvalAddress: innerExecutor },
    })
  })

  it('omits evm.approvalAddress when the swap response carries no approvalTx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          routes: [{ routeId: 'native-route', providers: ['ONEINCH'], expectedBuyAmount: '12.4' }],
        })
      )
      .mockResolvedValueOnce(
        response({
          expectedBuyAmount: '12.4',
          providers: ['ONEINCH'],
          tx: { from: '0xsender', to: '0xrouter', data: '0xabcdef', value: '0', gas: '21000' },
        })
      )

    vi.stubGlobal('fetch', fetchMock)
    configureSwapKit({ apiKey: 'test-key', baseUrl: 'https://swapkit.example' })

    const quote = await getSwapKitQuote({
      from: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
      to: { chain: Chain.Ethereum, address: '0xsender', ticker: 'USDC', decimals: 6 },
      amount: 10_000_000_000_000_000n,
    })

    expect(quote.tx.evm).toBeDefined()
    expect((quote.tx.evm as Record<string, unknown>).approvalAddress).toBeUndefined()
  })
})
