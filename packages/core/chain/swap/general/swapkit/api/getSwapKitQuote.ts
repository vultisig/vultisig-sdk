import { base64Decode } from '@bufbuild/protobuf/wire'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { GeneralSwapQuote, GeneralSwapTx } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import { SwapKitEnabledChain, SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

type Input = Record<TransferDirection, AccountCoin<SwapKitEnabledChain>> & {
  from: AccountCoin<SwapKitSourceChain>
  amount: bigint
  affiliateBps?: number
  /** Slippage tolerance in percent (e.g. 1 = 1%). Defaults to 3. */
  slippage?: number
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
  providerErrors?: {
    provider?: string
    message?: string
    errorCode?: string
  }[]
  error?: string
  message?: string
}

type SwapKitSwapResponse = {
  expectedBuyAmount?: string
  tx?: unknown
  targetAddress?: string
  depositAddress?: string
  inboundAddress?: string
  depositAmount?: string
  memo?: string
  swapId?: string
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

const swapKitTransferSourceChains = [
  Chain.Bitcoin,
  Chain.BitcoinCash,
  Chain.Dogecoin,
  Chain.Litecoin,
  Chain.Ripple,
  Chain.Ton,
  Chain.Tron,
  Chain.Zcash,
] as const

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

const isBelowMinimumError = (message: string) => {
  const lower = message.toLowerCase()

  // Rejection tokens that anchor the minimum-size patterns to actual failures.
  // Without them, phrases like 'minimum amount of gas used' (success context)
  // would produce false positives.
  const hasRejectionToken =
    lower.includes('rejected') ||
    lower.includes('failed') ||
    lower.includes('not met') ||
    lower.includes('required') ||
    lower.includes('too small') ||
    lower.includes('below') ||
    lower.includes('error') ||
    lower.includes('threshold')

  if (!hasRejectionToken) {
    return false
  }

  return (
    lower.includes('below minimum') ||
    lower.includes('belowminimum') ||
    lower.includes('minimum amount') ||
    lower.includes('min amount') ||
    lower.includes('amount too small') ||
    lower.includes('dust threshold') ||
    lower.includes('below the minimum')
  )
}

const isBelowMinimumErrorCode = (errorCode: string | undefined): boolean =>
  typeof errorCode === 'string' && errorCode.toUpperCase().includes('BELOW_MINIMUM')

/** Extracts the first below-minimum signal from providerErrors, if any. */
const extractBelowMinimumProviderError = (errors: SwapKitQuoteResponse['providerErrors']): string | undefined => {
  if (!errors?.length) {
    return undefined
  }

  for (const err of errors) {
    const raw = err.message
    // Guard: SwapKit schema marks message as optional string, but runtime values
    // may be numeric or nested objects. Skip non-string entries to avoid TypeError
    // from calling .toLowerCase() on a non-string.
    const isStringMsg = typeof raw === 'string'

    // Accept if the message pattern matches OR if the errorCode explicitly signals
    // a below-minimum rejection (handles cases where the message text is vague).
    if ((isStringMsg && isBelowMinimumError(raw)) || isBelowMinimumErrorCode(err.errorCode)) {
      const provider = err.provider ? `${err.provider}: ` : ''
      const msgText = isStringMsg ? raw : 'Amount below minimum'
      return `${provider}${msgText}`
    }
  }

  return undefined
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

  // BigInt() throws on decimal strings (e.g. '21000.5') — truncate first.
  if (typeof value === 'string' && value.includes('.')) {
    return BigInt(Math.trunc(Number(value))).toString()
  }

  return BigInt(value).toString()
}

const safeBigInt = (value: string | number | bigint | undefined): bigint | undefined => {
  if (value === undefined) {
    return undefined
  }

  // BigInt() throws on decimal strings — truncate first.
  if (typeof value === 'string' && value.includes('.')) {
    return BigInt(Math.trunc(Number(value)))
  }

  return BigInt(value)
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
      gasLimit: safeBigInt(gas),
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

const getTransferTargetAddress = ({ targetAddress, depositAddress, tx }: SwapKitSwapResponse): string | undefined => {
  if (targetAddress) {
    return targetAddress
  }

  if (depositAddress) {
    return depositAddress
  }

  if (Array.isArray(tx) && isRecord(tx[0]) && typeof tx[0].address === 'string') {
    return tx[0].address
  }

  return undefined
}

const toTransferAmount = (value: string | number | bigint, decimals: number): bigint => {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('SwapKit transfer route returned an invalid amount.')
    }

    return Number.isInteger(value) ? BigInt(value) : toChainAmount(value.toString(), decimals)
  }

  return value.includes('.') ? toChainAmount(value, decimals) : BigInt(value)
}

const getTransferAmount = ({ depositAmount, tx }: SwapKitSwapResponse, amount: bigint, decimals: number): bigint => {
  if (depositAmount) {
    return toChainAmount(depositAmount, decimals)
  }

  if (
    Array.isArray(tx) &&
    isRecord(tx[0]) &&
    (typeof tx[0].amount === 'string' || typeof tx[0].amount === 'number' || typeof tx[0].amount === 'bigint')
  ) {
    return toTransferAmount(tx[0].amount, decimals)
  }

  return amount
}

const shouldUseTransferTx = (chain: SwapKitSourceChain): chain is (typeof swapKitTransferSourceChains)[number] =>
  isOneOf(chain, swapKitTransferSourceChains)

const textEncoder = new TextEncoder()

const stringifyCanonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stringifyCanonicalJson).join(',')}]`
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .flatMap(key => {
        const item = value[key]

        return item === undefined ? [] : [`${JSON.stringify(key)}:${stringifyCanonicalJson(item)}`]
      })
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const encodeSwapKitTxPayload = (tx: unknown, txType?: string): Uint8Array => {
  const normalizedTxType = txType?.toUpperCase()

  if (normalizedTxType === 'CARDANO' || tx === undefined || tx === null) {
    return new Uint8Array()
  }

  if (typeof tx === 'string') {
    if (normalizedTxType === 'PSBT' || normalizedTxType === 'SUI') {
      return base64Decode(tx)
    }

    return textEncoder.encode(tx)
  }

  return textEncoder.encode(stringifyCanonicalJson(tx))
}

const buildTransferTx = (
  response: SwapKitSwapResponse,
  from: AccountCoin<SwapKitSourceChain>,
  amount: bigint
): GeneralSwapTx => {
  const to = getTransferTargetAddress(response)

  if (!to) {
    throw new Error('SwapKit transfer route did not return a target address.')
  }

  const transfer = {
    to,
    amount: getTransferAmount(response, amount, from.decimals),
    ...(response.memo ? { memo: response.memo } : {}),
    ...(response.meta?.txType ? { txType: response.meta.txType } : {}),
    ...(response.tx
      ? {
          txPayload: encodeSwapKitTxPayload(response.tx, response.meta?.txType),
        }
      : {}),
    ...(response.inboundAddress ? { inboundAddress: response.inboundAddress } : {}),
    ...(response.swapId ? { swapId: response.swapId } : {}),
  }

  return {
    transfer,
  }
}

const buildSwapKitTx = (
  response: SwapKitSwapResponse,
  from: AccountCoin<SwapKitSourceChain>,
  amount: bigint
): GeneralSwapTx => {
  if (from.chain === Chain.Solana) {
    return buildSolanaTx(response.tx, response.fees)
  }

  if (shouldUseTransferTx(from.chain)) {
    return buildTransferTx(response, from, amount)
  }

  return buildEvmTx(response.tx, from.address)
}

const routeExpectedBuyAmount = (route: SwapKitQuoteRoute, decimals: number): bigint | null => {
  if (!route.expectedBuyAmount) {
    return null
  }

  try {
    return BigInt(parseExpectedBuyAmount(route.expectedBuyAmount, decimals))
  } catch {
    return null
  }
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

const fetchSwapKitQuoteResponse = async (body: Record<string, unknown>): Promise<SwapKitQuoteResponse> => {
  const { apiKey, baseUrl } = getSwapKitConfig()
  const trimmedApiKey = apiKey?.trim()

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v3/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {}),
    },
    body: JSON.stringify(body),
  })

  // Capture raw text first so non-JSON error bodies (e.g. HTML from a load
  // balancer) are preserved for debugging instead of being swallowed silently.
  const rawText = await response.text().catch(() => '')
  let data: unknown
  try {
    data = rawText ? JSON.parse(rawText) : undefined
  } catch {
    data = undefined
  }

  if (!response.ok && !isRecord(data)) {
    const bodyHint = rawText ? ` body: ${rawText.slice(0, 200)}` : ''
    throw new Error(`SwapKit request failed (${response.status}): ${response.statusText}${bodyHint}`)
  }

  return (isRecord(data) ? data : {}) as SwapKitQuoteResponse
}

const getSwapKitRoutes = async (
  body: Record<string, unknown>,
  providers: SwapKitProvider[]
): Promise<SwapKitQuoteRoute[]> => {
  try {
    const quoteResponse = await fetchSwapKitQuoteResponse(
      withoutUndefinedFields({
        ...body,
        providers,
      })
    )

    if (quoteResponse.error) {
      const message = quoteResponse.message ?? quoteResponse.error

      if (isNoRouteError(message)) {
        // Before swallowing the no-route response, check if any provider
        // told us the amount is below their minimum — that's more actionable.
        const belowMinMsg = extractBelowMinimumProviderError(quoteResponse.providerErrors)
        if (belowMinMsg) {
          throw new Error(belowMinMsg)
        }

        return []
      }

      throw new Error(message)
    }

    const allowedRoutes = quoteResponse.routes?.filter(isAllowedRoute) ?? []

    // Below-minimum surfacing is gated on having NO allowed routes. The earlier
    // unconditional throw was a UX regression: when SwapKit returns
    // `routes: [NEAR_route], providerErrors: [{CHAINFLIP below-minimum}]`,
    // throwing the CHAINFLIP-below-min error would block the user from the
    // NEAR route they could otherwise execute. The actionable-hint argument
    // ("user could increase amount to unlock the rejected provider") is real
    // but a second-order optimization that doesn't justify breaking the
    // primary "we found a route, let them swap" path. If we later want to
    // surface "could be better with $larger amount" as a non-blocking hint,
    // the right place is the route metadata (separate channel from the
    // throw/return contract here). (#535 r3 — NeO preferably-blocking.)
    if (allowedRoutes.length === 0) {
      const belowMinMsg = extractBelowMinimumProviderError(quoteResponse.providerErrors)
      if (belowMinMsg) {
        throw new Error(belowMinMsg)
      }
    }

    return allowedRoutes
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

export const getSwapKitQuote = async ({
  from,
  to,
  amount,
  affiliateBps,
  slippage = 3,
}: Input): Promise<GeneralSwapQuote> => {
  const quoteBody = {
    sellAsset: toSwapKitAsset(from),
    buyAsset: toSwapKitAsset(to),
    sellAmount: formatBasicUnitAmount(amount, from.decimals),
    slippage,
    affiliateFee: affiliateBps,
  }
  const route = await getBestSwapKitRoute(quoteBody, to.decimals)

  const swapResponse = await postSwapKit<SwapKitSwapResponse>(
    '/v3/swap',
    withoutUndefinedFields({
      routeId: route.routeId,
      sourceAddress: from.address,
      destinationAddress: to.address,
      disableBalanceCheck: true,
      disableBuildTx: shouldUseTransferTx(from.chain) ? true : undefined,
    })
  )

  return {
    dstAmount: parseExpectedBuyAmount(swapResponse.expectedBuyAmount ?? route.expectedBuyAmount, to.decimals),
    provider: 'swapkit',
    routeProvider: getRouteProviderName(swapResponse) ?? getRouteProviderName(route),
    tx: buildSwapKitTx(swapResponse, from, amount),
  }
}
