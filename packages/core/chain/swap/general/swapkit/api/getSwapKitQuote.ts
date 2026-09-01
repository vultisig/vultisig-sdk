import { base64Decode } from '@bufbuild/protobuf/wire'
import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { areEqualTonAddresses, tonAddressToBounceable } from '@vultisig/core-chain/chains/ton/address'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { usdc } from '@vultisig/core-chain/coin/knownTokens'
import { GeneralSwapQuote, GeneralSwapTx } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import {
  assertSwapKitAddressReputation,
  assertSwapKitDestinationMatchesTarget,
} from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
import { SwapKitEnabledChain, SwapKitSourceChain } from '@vultisig/core-chain/swap/general/swapkit/SwapKitEnabledChains'
import {
  SwapKitAmountBelowMinimumError,
  SwapKitFeeShapeError,
  SwapKitNoEligibleRoutesError,
} from '@vultisig/core-chain/swap/general/swapkit/SwapKitErrors'
import {
  isSwapKitPairSupported,
  normalizeSwapKitProvider,
  swapKitExcludedProviders,
} from '@vultisig/core-chain/swap/general/swapkit/SwapKitProviders'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { attempt } from '@vultisig/lib-utils/attempt'
import { withoutUndefinedFields } from '@vultisig/lib-utils/record/withoutUndefinedFields'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'
import { address as btcAddress, networks, Psbt } from 'bitcoinjs-lib'

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
  /**
   * Realized directional price movement of this route, in basis points, signed
   * (negative == favorable). NOT the user-set tolerance every other
   * `slippageBps` in this repo denotes (`DEFAULT_JUPITER_SLIPPAGE_BPS`,
   * balancer, astroport) — it is the same quantity as `meta.priceImpact`, just
   * in bps, and serves as the fallback for routes whose meta the proxy omits.
   *
   * Typed loosely because nothing validates the proxy's JSON before it lands
   * here; `routePriceImpact` is what narrows it.
   */
  totalSlippageBps?: unknown
  meta?: {
    /**
     * Signed fractional price movement (`0.0133` == 1.33% of output lost).
     * Read as a fraction by both native clients — iOS's Price Impact row and
     * Android's `SwapKitRouteMeta.priceImpact`, which multiplies by 100 to
     * display — and self-consistent with the `totalSlippageBps / 10_000`
     * fallback.
     */
    priceImpact?: unknown
  }
}

type SwapKitQuoteResponse = {
  routes?: SwapKitQuoteRoute[]
  providerErrors?: { provider?: string; message?: string; errorCode?: string }[]
  error?: string
  message?: string
}

type SwapKitFee = { type?: string; amount?: string; asset?: string; chain?: string }

type SwapKitSwapResponse = {
  expectedBuyAmount?: string
  tx?: unknown
  // SwapKit returns a ready-made ERC-20 approve tx for EVM routes whose executor
  // pulls the token via transferFrom from a spender that is NOT `tx.to` (e.g. the
  // 1inch executor behind the THORChain aggregator). Its `data` is approve(spender,
  // amount); the spender is the REAL allowance target. We thread that spender onto
  // GeneralSwapTx.evm.approvalAddress so the consumer (mcp-ts execute_swap) emits
  // the approve to the correct address. On-chain proof of the gap this closes:
  // tx 0xa3aadf17 reverted "ERC20: transfer amount exceeds allowance" — vault had
  // allowance to tx.to (Diamond 0x9025B8ff…) but 0 to the 1inch executor.
  approvalTx?: { to?: string; data?: string }
  targetAddress?: string
  depositAddress?: string
  inboundAddress?: string
  depositAmount?: string
  memo?: string
  swapId?: string
  providers?: string[]
  legs?: { provider?: string }[]
  fees?: SwapKitFee[]
  meta?: { txType?: string }
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
  // Sui rides the transfer arm for its pre-built PTB, the same way Bitcoin
  // rides it for a PSBT: `txType`/`txPayload` carry the opaque signing bytes
  // while `to`/`amount` stay informational (both are baked into the PTB).
  Chain.Sui,
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

const routeProviderNames = ({ providers, legs }: Pick<SwapKitQuoteRoute, 'providers' | 'legs'>): string[] => {
  const names = [...(providers ?? []), ...(legs ?? []).map(({ provider }) => provider)].filter(
    (provider): provider is string => !!provider
  )

  return [...new Set(names.map(normalizeSwapKitProvider))]
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
    headers: { 'Content-Type': 'application/json', ...(trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {}) },
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

type SwapKitAssetCoin = Pick<AccountCoin<SwapKitEnabledChain>, 'chain' | 'decimals' | 'id' | 'ticker'>

const toSwapKitAsset = ({ chain, id, ticker }: Pick<SwapKitAssetCoin, 'chain' | 'id' | 'ticker'>) => {
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

// Decode the spender from a SwapKit-provided approve() calldata
// (approve(address spender, uint256 amount) — selector 0x095ea7b3). Returns the
// 20-byte spender address, or undefined if the calldata is missing/not an approve.
const decodeApproveSpender = (data: string | undefined): string | undefined => {
  if (typeof data !== 'string' || !data.startsWith('0x095ea7b3') || data.length < 74) {
    return undefined
  }
  const spender = `0x${data.slice(34, 74)}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(spender)) {
    return undefined
  }
  // Mirror LiFi's zero-address omit: an approve() to the zero address is never
  // a real allowance target, so surface nothing and let the consumer keep the
  // tx.to fallback instead of emitting a spurious zero-address approval.
  return spender === '0x0000000000000000000000000000000000000000' ? undefined : spender
}

type BuildEvmTxInput = {
  tx: unknown
  fromAddress: string
  targetAddress: string | undefined
  chain: Chain
  approvalTx?: SwapKitSwapResponse['approvalTx']
  /** Omitted when the response itemizes no affiliate/service fee at all. */
  affiliateFee?: SwapFee
}

const buildEvmTx = async ({
  tx,
  fromAddress,
  targetAddress,
  chain,
  approvalTx,
  affiliateFee,
}: BuildEvmTxInput): Promise<GeneralSwapTx> => {
  if (!isRecord(tx)) {
    throw new Error('SwapKit EVM route did not return a transaction object.')
  }

  const evmTx = tx as SwapKitEvmTx

  if (!evmTx.to) {
    throw new Error('SwapKit EVM transaction is missing a required to field.')
  }

  // sdk#1458: tx.to and targetAddress share the same untrusted /v3/swap response, so
  // equality is defense in depth rather than an independent trust boundary.
  assertSwapKitDestinationMatchesTarget(evmTx.to, targetAddress, chain)

  const gas = evmTx.gasLimit ?? evmTx.gas

  // When SwapKit hands back a ready-made approve tx, its spender is the REAL
  // allowance target (often an inner executor != tx.to). Surface it so the
  // consumer approves the correct contract instead of the router.
  const approvalAddress = decodeApproveSpender(approvalTx?.data)

  // The Blockaid verdict is independent of SwapKit's response. Require an explicit
  // Benign result for both the transaction destination and any distinct approval
  // spender before either address can enter a signable quote.
  const reputationChecks = [assertSwapKitAddressReputation(evmTx.to, chain, 'transaction destination')]
  if (approvalAddress && approvalAddress.toLowerCase() !== evmTx.to.toLowerCase()) {
    reputationChecks.push(assertSwapKitAddressReputation(approvalAddress, chain, 'approval spender'))
  }

  await Promise.all(reputationChecks)

  return {
    evm: {
      from: evmTx.from ?? fromAddress,
      to: evmTx.to,
      data: evmTx.data ?? '0x',
      value: bigintString(evmTx.value),
      gasLimit: safeBigInt(gas),
      ...(approvalAddress ? { approvalAddress } : {}),
      // SwapKit itemizes the affiliate/service fee it charges. The Solana
      // branch already surfaces it; leaving it off the EVM branch made an
      // aggregator swap look like it carried no swap fee at all, so the fee row
      // had nothing to show and the total omitted it.
      //
      // Absent covers three cases — no fee entries, an itemized zero, and a
      // shape that could not be resolved — because none of them establishes an
      // amount we can vouch for. Consumers report the fee as part of the quoted
      // rate rather than asserting a zero.
      ...(affiliateFee && affiliateFee.amount > 0n ? { affiliateFee } : {}),
    },
  }
}

const getSwapKitFeeAmount = (fees: SwapKitSwapResponse['fees'], type: string, decimals: number): bigint => {
  return (fees ?? [])
    .filter(fee => fee.type?.toLowerCase() === type && fee.amount)
    .reduce((total, fee) => total + toChainAmount(fee.amount!, decimals), 0n)
}

const isZeroFeeAmount = (amount: string) => /^[+-]?(?:0+(?:\.0*)?|\.0+)$/.test(amount.trim())

const sameSwapFeeCoin = (one: SwapFee, another: SwapFee) =>
  one.chain === another.chain &&
  one.decimals === another.decimals &&
  (one.id ?? '').toLowerCase() === (another.id ?? '').toLowerCase()

const chainflipStableFeeCoin = {
  chain: Chain.Ethereum,
  decimals: usdc.decimals,
  id: usdc.id.toLowerCase(),
  ticker: usdc.ticker,
} satisfies SwapKitAssetCoin

const isChainflipProvider = (provider: string | undefined) =>
  provider === 'CHAINFLIP' || provider === 'CHAINFLIP_STREAMING'

const matchesSwapKitFeeChain = (feeChain: string | undefined, coinChain: SwapKitEnabledChain) => {
  if (!feeChain) {
    return true
  }

  const normalized = feeChain.toLowerCase()

  return normalized === coinChain.toLowerCase() || normalized === swapKitChainId[coinChain].toLowerCase()
}

const getSwapKitSwapFee = (
  fees: SwapKitSwapResponse['fees'],
  from: AccountCoin<SwapKitSourceChain>,
  to: AccountCoin<SwapKitEnabledChain>,
  routeProvider: string | undefined
): SwapFee => {
  const feeCoins: SwapKitAssetCoin[] = [
    from,
    to,
    ...(isChainflipProvider(routeProvider) ? [chainflipStableFeeCoin] : []),
  ]
  const candidates = feeCoins.map(coin => ({ coin, asset: toSwapKitAsset(coin).toLowerCase() }))
  let result: SwapFee | undefined

  for (const fee of fees ?? []) {
    const type = fee.type?.toLowerCase()

    if ((type !== 'affiliate' && type !== 'service') || !fee.amount || isZeroFeeAmount(fee.amount)) {
      continue
    }

    if (!fee.asset) {
      throw new SwapKitFeeShapeError(`SwapKit ${type} fee is missing its asset.`)
    }

    const candidate = candidates.find(
      ({ asset, coin }) => asset === fee.asset!.toLowerCase() && matchesSwapKitFeeChain(fee.chain, coin.chain)
    )

    if (!candidate) {
      throw new SwapKitFeeShapeError(`SwapKit ${type} fee uses unsupported asset ${fee.asset}.`)
    }

    const current: SwapFee = {
      amount: toChainAmount(fee.amount, candidate.coin.decimals),
      chain: candidate.coin.chain,
      id: candidate.coin.id,
      decimals: candidate.coin.decimals,
    }

    if (current.amount < 0n) {
      throw new SwapKitFeeShapeError(`SwapKit ${type} fee amount cannot be negative.`)
    }

    if (result && !sameSwapFeeCoin(result, current)) {
      throw new SwapKitFeeShapeError('SwapKit affiliate and service fees use different assets.')
    }

    result = result ? { ...result, amount: result.amount + current.amount } : current
  }

  return result ?? { amount: 0n, chain: from.chain, id: from.id, decimals: from.decimals }
}

const buildSolanaTx = (
  tx: unknown,
  fees: SwapKitSwapResponse['fees'],
  from: AccountCoin<SwapKitSourceChain>,
  to: AccountCoin<SwapKitEnabledChain>,
  routeProvider: string | undefined
): GeneralSwapTx => {
  if (typeof tx !== 'string') {
    throw new Error('SwapKit Solana route did not return a serialized transaction string.')
  }

  const decimals = chainFeeCoin[Chain.Solana].decimals
  const networkFee = getSwapKitFeeAmount(fees, 'network', decimals)

  return { solana: { data: tx, networkFee, swapFee: getSwapKitSwapFee(fees, from, to, routeProvider) } }
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

const isTransferAmountValue = (value: unknown): value is string | number | bigint =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint'

const getTransferAmount = ({ depositAmount, tx }: SwapKitSwapResponse, amount: bigint, decimals: number): bigint => {
  if (depositAmount) {
    return toChainAmount(depositAmount, decimals)
  }

  if (Array.isArray(tx) && isRecord(tx[0]) && isTransferAmountValue(tx[0].amount)) {
    return toTransferAmount(tx[0].amount, decimals)
  }

  return amount
}

/**
 * The single transfer SwapKit describes in its `tx[]` array, or `undefined`
 * when `tx` is any other shape — an EVM object, an opaque PSBT / PTB string, or
 * absent because `disableBuildTx` was sent.
 *
 * More than one entry is rejected rather than ignored: only `tx[0]` is ever
 * built, so a multi-transfer route would be signed as a partial deposit that
 * under-funds the swap. The count is checked before the entry shape so a
 * malformed trailing entry cannot slip a multi-transfer array past this guard.
 */
const getTransferTxEntry = (tx: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(tx) || tx.length === 0) {
    return undefined
  }

  if (tx.length > 1) {
    throw new Error(
      `SwapKit transfer route returned ${tx.length} transfers; only the first would be signed, so the swap would be under-funded.`
    )
  }

  return isRecord(tx[0]) ? tx[0] : undefined
}

/**
 * The agreed TON deposit destination in its bounceable (`EQ…`) form.
 *
 * `assertTransferAgreement` compares TON spellings by account, so a route whose
 * fields spell one account as `UQ…`, raw `0:hex` and `EQ…` passes — and the
 * spelling that wins the precedence order is what the signer would otherwise
 * read the bounce flag from. A deposit that goes out non-bounceable to a
 * rejecting contract is absorbed instead of refunded, so the agreed account is
 * re-spelled bounceable here, whichever field it came from. A string that is
 * not a TON address at all cannot be a deposit destination and is refused.
 */
const toCanonicalTonDeposit = (destination: string): string => {
  const canonical = attempt(() => tonAddressToBounceable(destination))

  if ('error' in canonical) {
    throw new Error(`SwapKit transfer route returned an invalid TON deposit address: ${destination}`)
  }

  return canonical.data
}

const areEqualTransferAddresses = (left: string, right: string, chain: SwapKitSourceChain): boolean =>
  chain === Chain.Ton ? areEqualTonAddresses(left, right) : left === right

/**
 * Fail closed when the `/v3/swap` response disagrees with itself about where
 * the deposit goes or how large it is.
 *
 * `targetAddress`, `depositAddress` and `tx[]` are independent fields carrying
 * the same fact, and the resolvers above take the first one that is present and
 * never look at the rest. So a response whose halves diverge — a provider bug,
 * an API change, a tampered payload — signs whichever field happens to win the
 * precedence order while the others name a different recipient or size, and
 * nothing downstream can tell. Neither field is authoritative enough to pick a
 * winner from, so a divergence is refused instead of resolved.
 *
 * Addresses are compared per chain because TON spells one account as `EQ…`,
 * `UQ…` or raw `workchain:hex` — comparing those as strings would reject
 * healthy routes.
 */
const assertTransferAgreement = (response: SwapKitSwapResponse, chain: SwapKitSourceChain, decimals: number): void => {
  const entry = getTransferTxEntry(response.tx)

  const destinations = [
    { field: 'targetAddress', value: response.targetAddress },
    { field: 'depositAddress', value: response.depositAddress },
    { field: 'tx[0].address', value: typeof entry?.address === 'string' ? entry.address : undefined },
  ].flatMap(({ field, value }) => (value?.trim() ? [{ field, value: value.trim() }] : []))

  const [primaryDestination, ...otherDestinations] = destinations
  if (primaryDestination) {
    const divergent = otherDestinations.find(
      ({ value }) => !areEqualTransferAddresses(value, primaryDestination.value, chain)
    )

    if (divergent) {
      throw new Error(
        `SwapKit transfer route disagrees with itself about the destination: ` +
          `${primaryDestination.field} is ${primaryDestination.value} but ${divergent.field} is ${divergent.value}.`
      )
    }
  }

  const txAmountValue = entry && isTransferAmountValue(entry.amount) ? entry.amount : undefined
  if (txAmountValue === undefined || !response.depositAmount) {
    return
  }

  const txAmount = toTransferAmount(txAmountValue, decimals)
  const depositAmount = toChainAmount(response.depositAmount, decimals)

  if (txAmount !== depositAmount) {
    throw new Error(
      `SwapKit transfer route disagrees with itself about the amount: ` +
        `depositAmount is ${response.depositAmount} (${depositAmount} base units) ` +
        `but tx[0].amount is ${txAmountValue} (${txAmount} base units).`
    )
  }
}

const shouldUseTransferTx = (chain: SwapKitSourceChain): chain is (typeof swapKitTransferSourceChains)[number] =>
  isOneOf(chain, swapKitTransferSourceChains)

// Transfer-arm chains that still need SwapKit to BUILD the transaction, so
// `/v3/swap` must not be sent `disableBuildTx`. Bitcoin gets a PSBT and Sui a
// pre-built PTB; in both cases those bytes drive signing directly, and asking
// SwapKit to skip construction returns a response with no `tx` at all. The
// remaining transfer chains are deposit-only (TON/XRP/ADA style) — they need
// nothing but an address, so skipping the build saves a pointless server-side
// construction that can fail on balance checks.
const swapKitPrebuiltTxSourceChains: ReadonlySet<SwapKitSourceChain> = new Set([Chain.Bitcoin, Chain.Sui])

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

const getBitcoinPsbtDestinationAmount = ({
  txPayload,
  senderAddress,
  targetAddress,
}: {
  txPayload: Uint8Array
  senderAddress: string
  targetAddress: string
}): bigint | undefined => {
  try {
    const psbt = Psbt.fromBuffer(Buffer.from(txPayload))
    const senderScript = Buffer.from(btcAddress.toOutputScript(senderAddress, networks.bitcoin))
    const targetScript = Buffer.from(btcAddress.toOutputScript(targetAddress, networks.bitcoin))
    const destinationOutputs = psbt.txOutputs.filter(({ script }) => {
      const outputScript = Buffer.from(script)

      return !outputScript.equals(senderScript) && outputScript.equals(targetScript)
    })

    return destinationOutputs.length === 1 ? BigInt(destinationOutputs[0].value) : undefined
  } catch {
    return undefined
  }
}

const buildTransferTx = (
  response: SwapKitSwapResponse,
  from: AccountCoin<SwapKitSourceChain>,
  amount: bigint
): GeneralSwapTx => {
  assertTransferAgreement(response, from.chain, from.decimals)

  const agreedDestination = getTransferTargetAddress(response)

  if (!agreedDestination) {
    throw new Error('SwapKit transfer route did not return a target address.')
  }

  const to = from.chain === Chain.Ton ? toCanonicalTonDeposit(agreedDestination) : agreedDestination

  // SwapKit renames base64 tx types on the wire without versioning — `SOLANA`
  // became `SERIALIZED_BASE64` and `CARDANO` became `CBOR` mid-flight (iOS
  // accepts both spellings in `SwapKitSwapResponse.decodeTx`). A Sui route's
  // `meta.txType` therefore cannot be trusted to read `SUI`. The source chain
  // is the reliable discriminator, and normalizing here also keeps
  // `SwapKitSwapPayload.txType` byte-identical to what iOS stamps
  // (`buildSwapKitSuiPayload` hardcodes `"SUI"`) — cosigning peers must agree.
  const wireTxType = response.meta?.txType
  const txType = from.chain === Chain.Sui ? 'SUI' : wireTxType

  if (from.chain === Chain.Sui && response.tx !== undefined && typeof response.tx !== 'string') {
    throw new Error('SwapKit Sui route did not return a base64 programmable transaction block.')
  }

  const txPayload = response.tx ? encodeSwapKitTxPayload(response.tx, txType) : undefined
  const psbtDestinationAmount =
    from.chain === Chain.Bitcoin && txType?.toUpperCase() === 'PSBT' && txPayload?.length
      ? getBitcoinPsbtDestinationAmount({ txPayload, senderAddress: from.address, targetAddress: to })
      : undefined

  const transfer = {
    to,
    amount: psbtDestinationAmount ?? getTransferAmount(response, amount, from.decimals),
    ...(response.memo ? { memo: response.memo } : {}),
    ...(txType ? { txType } : {}),
    ...(response.tx ? { txPayload } : {}),
    ...(response.inboundAddress ? { inboundAddress: response.inboundAddress } : {}),
    ...(response.swapId ? { swapId: response.swapId } : {}),
  }

  return { transfer }
}

// Cardano is an eligible SwapKit SOURCE chain for quote-dispatch purposes (see
// SwapKitEnabledChains.ts) but has no wired tx-build path here yet:
// `encodeSwapKitTxPayload` explicitly returns an EMPTY byte array for
// `normalizedTxType === 'CARDANO'` — there is no decode implementation at all,
// so any tx built from it would be silently wrong. iOS covers this with a
// separate `CARDANO_PREBUILT` CBOR path (`SwapKitCardanoSigner.swift`); porting
// that decode is follow-on work.
//
// Rejected in `getSwapKitQuote` BEFORE the network round-trip (no route/swap
// API calls wasted on a request that can never produce a signable tx).
const SWAP_SOURCE_TX_BUILD_UNSUPPORTED: ReadonlySet<SwapKitSourceChain> = new Set([Chain.Cardano])

const buildSwapKitTx = (
  response: SwapKitSwapResponse,
  from: AccountCoin<SwapKitSourceChain>,
  to: AccountCoin<SwapKitEnabledChain>,
  amount: bigint,
  routeProvider: string | undefined
): GeneralSwapTx | Promise<GeneralSwapTx> => {
  if (from.chain === Chain.Solana) {
    return buildSolanaTx(response.tx, response.fees, from, to, routeProvider)
  }

  if (shouldUseTransferTx(from.chain)) {
    return buildTransferTx(response, from, amount)
  }

  return buildEvmTx({
    tx: response.tx,
    fromAddress: from.address,
    targetAddress: response.targetAddress,
    chain: from.chain,
    approvalTx: response.approvalTx,
    affiliateFee: getSwapKitEvmSwapFee({ fees: response.fees, from, to, routeProvider }),
  })
}

type GetSwapKitEvmSwapFeeInput = {
  fees: SwapKitSwapResponse['fees']
  from: AccountCoin<SwapKitSourceChain>
  to: AccountCoin<SwapKitEnabledChain>
  routeProvider: string | undefined
}

/**
 * SwapKit's affiliate/service fee for an EVM route, or `undefined` when its
 * shape cannot be resolved.
 *
 * The fee is not part of the signed EVM transaction — `from`/`to`/`data`/
 * `value`/`gas` are — so an unexpected shape must never take down a route that
 * would otherwise sign. Only [SwapKitFeeShapeError] is swallowed; anything else
 * is a bug in the resolution and stays loud. The Solana branch calls
 * `getSwapKitSwapFee` bare and lets it throw on purpose: its tx type requires
 * the fee, so an unresolved one really is fatal there.
 */
const getSwapKitEvmSwapFee = ({ fees, from, to, routeProvider }: GetSwapKitEvmSwapFeeInput): SwapFee | undefined => {
  try {
    return getSwapKitSwapFee(fees, from, to, routeProvider)
  } catch (error) {
    if (!(error instanceof SwapKitFeeShapeError)) {
      throw error
    }

    console.warn('[getSwapKitQuote] unresolved SwapKit fee on an EVM route; reporting none', error)
    return undefined
  }
}

const bpsPerUnit = 10_000

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Price impact of a route as a signed fraction, preferring `meta.priceImpact`
 * (the figure iOS and Android show) and falling back to the same directional
 * movement expressed in bps for routes whose meta the proxy omits.
 *
 * Both are narrowed rather than trusted: nothing validates the proxy's JSON on
 * the way in, so an explicit `null` or a stringified number would otherwise
 * land in a `number` field and reach consumers as `null.toFixed(...)` or a
 * 100x-wrong figure. A value that fails the check falls through to the next
 * source, and an unreadable pair reports nothing at all.
 */
const routePriceImpact = ({ meta, totalSlippageBps }: SwapKitQuoteRoute): number | undefined => {
  const metaImpact = finiteNumber(meta?.priceImpact)
  if (metaImpact !== undefined) {
    return metaImpact
  }

  const slippageBps = finiteNumber(totalSlippageBps)

  return slippageBps === undefined ? undefined : slippageBps / bpsPerUnit
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
    headers: { 'Content-Type': 'application/json', ...(trimmedApiKey ? { 'x-api-key': trimmedApiKey } : {}) },
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
    const quoteResponse = await fetchSwapKitQuoteResponse(withoutUndefinedFields({ ...body, providers }))

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

  throw new SwapKitNoEligibleRoutesError()
}

export const getSwapKitQuote = async ({
  from,
  to,
  amount,
  affiliateBps,
  slippage = 3,
}: Input): Promise<GeneralSwapQuote> => {
  if (SWAP_SOURCE_TX_BUILD_UNSUPPORTED.has(from.chain)) {
    throw new Error(
      `SwapKit ${from.chain} source swaps are not yet supported for signing (quote-only for now). ` +
        'Try a different source chain, or swap the other direction.'
    )
  }

  const quoteBody = {
    sellAsset: toSwapKitAsset(from),
    buyAsset: toSwapKitAsset(to),
    sellAmount: formatBasicUnitAmount(amount, from.decimals),
    slippage,
    affiliateFee: affiliateBps,
  }
  let route: SwapKitQuoteRoute
  try {
    route = await getBestSwapKitRoute(quoteBody, to.decimals)
  } catch (error) {
    // SwapKit's `noRoutesFound` 404 can't distinguish "amount below provider
    // minimum" from "pair unsupported". When the pair IS structurally supported
    // (per the /providers snapshot), reclassify so the form shows the actionable
    // "amount too small" copy instead of a misleading "no route" error (#4418).
    if (
      error instanceof SwapKitNoEligibleRoutesError &&
      (await isSwapKitPairSupported({ from: from.chain, to: to.chain }))
    ) {
      throw new SwapKitAmountBelowMinimumError(from.chain, to.chain)
    }
    throw error
  }

  const swapResponse = await postSwapKit<SwapKitSwapResponse>(
    '/v3/swap',
    withoutUndefinedFields({
      routeId: route.routeId,
      sourceAddress: from.address,
      destinationAddress: to.address,
      disableBalanceCheck: true,
      disableBuildTx:
        shouldUseTransferTx(from.chain) && !swapKitPrebuiltTxSourceChains.has(from.chain) ? true : undefined,
    })
  )
  const routeProvider = getRouteProviderName(swapResponse) ?? getRouteProviderName(route)

  // Read from the quote-stage route, unlike `dstAmount` and `routeProvider`
  // which prefer the swap-stage response. No `/v3/swap` shape we model carries
  // impact, and both native clients read it off the chosen route the same way;
  // if it is ever restated there, it should be preferred here too.
  const priceImpactFraction = routePriceImpact(route)

  return {
    dstAmount: parseExpectedBuyAmount(swapResponse.expectedBuyAmount ?? route.expectedBuyAmount, to.decimals),
    provider: 'swapkit',
    routeProvider,
    ...(priceImpactFraction === undefined ? {} : { priceImpactFraction }),
    tx: await buildSwapKitTx(swapResponse, from, to, amount, routeProvider),
  }
}
