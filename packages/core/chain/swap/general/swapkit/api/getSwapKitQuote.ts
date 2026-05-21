import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { GeneralSwapQuote, GeneralSwapTx } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import { SwapKitEnabledChain, SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

type Input = Record<TransferDirection, AccountCoin<SwapKitEnabledChain>> & {
  from: AccountCoin<SwapKitSourceChain>
  amount: bigint
  affiliateBps?: number
}

type SwapKitProvider =
  | 'CAMELOT_V3'
  | 'CHAINFLIP'
  | 'CHAINFLIP_STREAMING'
  | 'FLASHNET'
  | 'GARDEN'
  | 'HARBOR'
  | 'JUPITER'
  | 'NEAR'
  | 'OKX'
  | 'ONEINCH'
  | 'OPENOCEAN_V2'
  | 'PANCAKESWAP'
  | 'PANGOLIN_V1'
  | 'SUSHISWAP_V2'
  | 'TRADERJOE_V2'
  | 'UNISWAP_V2'
  | 'UNISWAP_V3'

const swapKitAllowedProviders: SwapKitProvider[] = [
  'CHAINFLIP',
  'CHAINFLIP_STREAMING',
  'NEAR',
  'GARDEN',
  'FLASHNET',
  'HARBOR',
  'ONEINCH',
  'UNISWAP_V2',
  'UNISWAP_V3',
  'JUPITER',
  'OKX',
  'PANCAKESWAP',
  'SUSHISWAP_V2',
  'TRADERJOE_V2',
  'PANGOLIN_V1',
  'CAMELOT_V3',
  'OPENOCEAN_V2',
]

const swapKitProviderQuoteAttempts: SwapKitProvider[][] = [
  swapKitAllowedProviders,
  ['NEAR'],
  ['CHAINFLIP', 'CHAINFLIP_STREAMING'],
  ['GARDEN'],
  ['FLASHNET'],
  ['HARBOR'],
  ['JUPITER'],
  [
    'ONEINCH',
    'UNISWAP_V2',
    'UNISWAP_V3',
    'OKX',
    'PANCAKESWAP',
    'SUSHISWAP_V2',
    'TRADERJOE_V2',
    'PANGOLIN_V1',
    'CAMELOT_V3',
    'OPENOCEAN_V2',
  ],
]

const swapKitExcludedProviders = new Set(['THORCHAIN', 'THORCHAIN_STREAMING', 'MAYACHAIN', 'MAYACHAIN_STREAMING'])

const swapKitChainId: Record<SwapKitEnabledChain, string> = {
  [Chain.Arbitrum]: 'ARB',
  [Chain.Avalanche]: 'AVAX',
  [Chain.Base]: 'BASE',
  [Chain.Bitcoin]: 'BTC',
  [Chain.BitcoinCash]: 'BCH',
  [Chain.BSC]: 'BSC',
  [Chain.Cardano]: 'ADA',
  [Chain.Cosmos]: 'GAIA',
  [Chain.Dash]: 'DASH',
  [Chain.Dogecoin]: 'DOGE',
  [Chain.Ethereum]: 'ETH',
  [Chain.Kujira]: 'KUJI',
  [Chain.Litecoin]: 'LTC',
  [Chain.MayaChain]: 'MAYA',
  [Chain.Optimism]: 'OP',
  [Chain.Polygon]: 'POL',
  [Chain.Ripple]: 'XRP',
  [Chain.Solana]: 'SOL',
  [Chain.Sui]: 'SUI',
  [Chain.THORChain]: 'THOR',
  [Chain.Ton]: 'TON',
  [Chain.Tron]: 'TRON',
  [Chain.Zcash]: 'ZEC',
}

type SwapKitQuoteRoute = {
  routeId: string
  providers?: string[]
  expectedBuyAmount?: string
  legs?: { provider?: string }[]
  warnings?: { display?: string; message?: string }[]
}

type SwapKitQuoteResponse = {
  routes?: SwapKitQuoteRoute[]
  providerErrors?: { provider?: string; message?: string; errorCode?: string }[]
  error?: string
  message?: string
}

type SwapKitSwapResponse = {
  expectedBuyAmount?: string
  tx?: unknown
  providers?: string[]
  legs?: { provider?: string }[]
  fees?: { type?: string; amount?: string }[]
  meta?: {
    txType?: string
  }
}

type SwapKitEvmTx = {
  from?: string
  to?: string
  data?: string
  value?: string | number | bigint
  gas?: string | number | bigint
  gasLimit?: string | number | bigint
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const formatBasicUnitAmount = (amount: bigint, decimals: number): string => {
  const sign = amount < 0n ? '-' : ''
  const abs = amount < 0n ? -amount : amount

  if (decimals === 0) {
    return `${sign}${abs.toString()}`
  }

  const divisor = 10n ** BigInt(decimals)
  const whole = abs / divisor
  const fraction = (abs % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')

  return fraction ? `${sign}${whole.toString()}.${fraction}` : `${sign}${whole.toString()}`
}

const normalizeProvider = (provider: string) => provider.trim().toUpperCase().replace(/[-\s]/g, '_')

const routeProviderNames = ({ providers, legs }: Pick<SwapKitQuoteRoute, 'providers' | 'legs'>): string[] => {
  const names = [...(providers ?? []), ...(legs ?? []).map(({ provider }) => provider)].filter(
    (provider): provider is string => !!provider
  )

  return [...new Set(names.map(normalizeProvider))]
}

const isAllowedRoute = (route: SwapKitQuoteRoute) =>
  routeProviderNames(route).every(provider => !swapKitExcludedProviders.has(provider))

const isNoRouteError = (message: string) => {
  const normalizedMessage = message.toLowerCase().replace(/[\s_-]/g, '')

  return normalizedMessage.includes('noroutesfound') || normalizedMessage.includes('noroutes')
}

const getRouteProviderName = (route: Pick<SwapKitQuoteRoute, 'providers' | 'legs'>) => {
  const [firstProvider] = routeProviderNames(route).filter(provider => !swapKitExcludedProviders.has(provider))

  return firstProvider
}

const parseExpectedBuyAmount = (amount: string | undefined, decimals: number): string => {
  if (!amount) {
    throw new Error('SwapKit quote did not include an expected buy amount.')
  }

  return toChainAmount(amount, decimals).toString()
}

const postSwapKit = async <T>(path: string, body: Record<string, unknown>): Promise<T> => {
  const { apiKey, baseUrl } = getSwapKitConfig()
  const trimmedApiKey = apiKey?.trim()

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {}),
    },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => undefined)

  if (!response.ok) {
    const message = isRecord(data)
      ? typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : response.statusText
      : response.statusText
    throw new Error(`SwapKit request failed (${response.status}): ${message}`)
  }

  return data as T
}

const toSwapKitAsset = ({ chain, id, ticker }: AccountCoin<SwapKitEnabledChain>) => {
  const chainId = swapKitChainId[chain]
  const symbol = id ? ticker : chainFeeCoin[chain].ticker

  return id ? `${chainId}.${symbol}-${id}` : `${chainId}.${symbol}`
}

const bigintString = (value: string | number | bigint | undefined, fallback = '0') => {
  if (value === undefined) {
    return fallback
  }

  return BigInt(value).toString()
}

const buildEvmTx = (tx: unknown, fromAddress: string): GeneralSwapTx => {
  if (!isRecord(tx)) {
    throw new Error('SwapKit EVM route did not return a transaction object.')
  }

  const evmTx = tx as SwapKitEvmTx

  if (!evmTx.to) {
    throw new Error('SwapKit EVM transaction is missing a required to field.')
  }

  const gas = evmTx.gasLimit ?? evmTx.gas

  return {
    evm: {
      from: evmTx.from ?? fromAddress,
      to: evmTx.to,
      data: evmTx.data ?? '0x',
      value: bigintString(evmTx.value),
      gasLimit: gas === undefined ? undefined : BigInt(gas),
    },
  }
}

const getSwapKitFeeAmount = (fees: SwapKitSwapResponse['fees'], type: string, decimals: number): bigint => {
  const fee = fees?.find(fee => fee.type?.toLowerCase() === type)

  if (!fee?.amount) {
    return 0n
  }

  return toChainAmount(fee.amount, decimals)
}

const buildSolanaTx = (tx: unknown, fees: SwapKitSwapResponse['fees']): GeneralSwapTx => {
  if (typeof tx !== 'string') {
    throw new Error('SwapKit Solana route did not return a serialized transaction string.')
  }

  const decimals = chainFeeCoin[Chain.Solana].decimals
  const networkFee = getSwapKitFeeAmount(fees, 'network', decimals)
  const swapFee = getSwapKitFeeAmount(fees, 'affiliate', decimals) + getSwapKitFeeAmount(fees, 'service', decimals)

  return {
    solana: {
      data: tx,
      networkFee,
      swapFee: {
        amount: swapFee,
        decimals,
        chain: Chain.Solana,
      },
    },
  }
}

const buildSwapKitTx = (response: SwapKitSwapResponse, from: AccountCoin<SwapKitSourceChain>): GeneralSwapTx => {
  if (from.chain === Chain.Solana) {
    return buildSolanaTx(response.tx, response.fees)
  }

  return buildEvmTx(response.tx, from.address)
}

const routeExpectedBuyAmount = (route: SwapKitQuoteRoute, decimals: number): bigint | null => {
  if (!route.expectedBuyAmount) {
    return null
  }

  return BigInt(parseExpectedBuyAmount(route.expectedBuyAmount, decimals))
}

const sortRoutesByExpectedBuyAmount = (routes: SwapKitQuoteRoute[], decimals: number) =>
  [...routes].sort((one, another) => {
    const oneAmount = routeExpectedBuyAmount(one, decimals)
    const anotherAmount = routeExpectedBuyAmount(another, decimals)

    if (oneAmount === null) {
      return anotherAmount === null ? 0 : 1
    }

    if (anotherAmount === null) {
      return -1
    }

    if (oneAmount === anotherAmount) {
      return 0
    }

    return oneAmount > anotherAmount ? -1 : 1
  })

const getSwapKitRoutes = async (
  body: Record<string, unknown>,
  providers: SwapKitProvider[]
): Promise<SwapKitQuoteRoute[]> => {
  try {
    const quoteResponse = await postSwapKit<SwapKitQuoteResponse>(
      '/v3/quote',
      withoutUndefinedFields({
        ...body,
        providers,
      })
    )

    if (quoteResponse.error) {
      const message = quoteResponse.message ?? quoteResponse.error

      if (isNoRouteError(message)) {
        return []
      }

      throw new Error(message)
    }

    return quoteResponse.routes?.filter(isAllowedRoute) ?? []
  } catch (error) {
    if (error instanceof Error && isNoRouteError(error.message)) {
      return []
    }

    throw error
  }
}

const getBestSwapKitRoute = async (body: Record<string, unknown>, decimals: number) => {
  for (const providers of swapKitProviderQuoteAttempts) {
    const routes = await getSwapKitRoutes(body, providers)

    if (routes.length) {
      return sortRoutesByExpectedBuyAmount(routes, decimals)[0]
    }
  }

  throw new Error('SwapKit returned no eligible routes.')
}

export const getSwapKitQuote = async ({ from, to, amount, affiliateBps }: Input): Promise<GeneralSwapQuote> => {
  const quoteBody = {
    sellAsset: toSwapKitAsset(from),
    buyAsset: toSwapKitAsset(to),
    sellAmount: formatBasicUnitAmount(amount, from.decimals),
    slippage: 3,
    affiliateFee: affiliateBps,
  }
  const route = await getBestSwapKitRoute(quoteBody, to.decimals)

  const swapResponse = await postSwapKit<SwapKitSwapResponse>('/v3/swap', {
    routeId: route.routeId,
    sourceAddress: from.address,
    destinationAddress: to.address,
    disableBalanceCheck: true,
  })

  return {
    dstAmount: parseExpectedBuyAmount(swapResponse.expectedBuyAmount ?? route.expectedBuyAmount, to.decimals),
    provider: 'swapkit',
    routeProvider: getRouteProviderName(swapResponse) ?? getRouteProviderName(route),
    tx: buildSwapKitTx(swapResponse, from),
  }
}
