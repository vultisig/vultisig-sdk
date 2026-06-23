import { getAddress, isAddress } from 'viem'

import { assertSafeDestination } from '../../utils/dangerousAddresses'

/**
 * Across bridge quote (read-only).
 *
 * Vault-free, zero-signing primitive ported from the mcp-ts `get_across_quote`
 * tool into the SDK as part of the mcp-ts/backend → SDK code-as-action
 * consolidation. This fetches a live Across `suggested-fees` quote and verifies
 * that the returned origin/destination SpokePool addresses match the pinned
 * deployments. It NEVER builds calldata, signs, or broadcasts.
 */

const ACROSS_API_BASE = 'https://app.across.to/api'
const ETHEREUM_ORIGIN_CHAIN = 'Ethereum'
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * Across-supported EVM chains for the current factory scope. Origin is pinned to
 * Ethereum; any of these (except the origin) can be a destination.
 */
export const acrossSupportedChains = [
  'Ethereum',
  'Optimism',
  'Polygon',
  'Arbitrum',
  'Base',
  'Blast',
  'BSC',
  'Zksync',
] as const

export type AcrossChain = (typeof acrossSupportedChains)[number]

const acrossChainIds = {
  Ethereum: 1,
  Optimism: 10,
  Polygon: 137,
  Arbitrum: 42161,
  Base: 8453,
  Blast: 81457,
  BSC: 56,
  Zksync: 324,
} as const satisfies Record<AcrossChain, number>

/**
 * Pinned Across SpokePool deployments. The live quote MUST echo these for the
 * route to be considered safe — a 200 that omits or mismatches the field is a
 * fail-closed error, never silently overridden with the local pin.
 */
const acrossSpokePools = {
  Ethereum: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  Optimism: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
  Polygon: '0x9295ee1d8c5b022be115a2ad3c30c72e34e7f096',
  Arbitrum: '0xe35e9842fceaca96570b734083f4a58e8f7c5f2a',
  Base: '0x09aea4b2242abc8bb4bb78d537a67a245a7bec64',
  Blast: '0x2D509190Ed0172ba588407D4c2df918F955Cc6E1',
  BSC: '0x4e8E2fD692c1A2fD815bC048C600008dBdABd505',
  Zksync: '0xE0B015E54d54fc84a6cB9B666099c46adE9335FF',
} as const satisfies Record<AcrossChain, `0x${string}`>

export type AcrossQuoteParams = {
  /** Origin chain. Pinned to Ethereum for the current factory scope. */
  sourceChain: AcrossChain
  /** Destination EVM chain. Must differ from the origin. */
  destinationChain: AcrossChain
  /** Input token contract on the source chain. Use WETH for native ETH routes. */
  inputToken: string
  /** Output token contract on the destination chain. */
  outputToken: string
  /** Input amount in token base units (integer string), e.g. "1000000" for 1 USDC. */
  amount: string
  /** Optional recipient used by Across for quote simulation only. */
  to?: string
  /** Only set when the caller explicitly accepts mismatched input/output decimals. */
  allowUnmatchedDecimals?: boolean
}

type AcrossTokenInfo = {
  address?: string
  symbol?: string
  decimals?: number
  chainId?: number
}

type AcrossSuggestedFees = {
  estimatedFillTimeSec?: number
  relayFeePct?: string
  relayFeeTotal?: string
  lpFeePct?: string
  lpFeeTotal?: string
  timestamp?: string
  isAmountTooLow?: boolean
  quoteBlock?: string
  exclusiveRelayer?: string
  exclusivityDeadline?: number
  spokePoolAddress?: string
  destinationSpokePoolAddress?: string
  totalRelayFee?: { pct?: string; total?: string }
  relayerCapitalFee?: { pct?: string; total?: string }
  relayerGasFee?: { pct?: string; total?: string }
  lpFee?: { pct?: string; total?: string }
  limits?: {
    minDeposit?: string
    maxDeposit?: string
    maxDepositInstant?: string
    maxDepositShortDelay?: string
    recommendedDepositInstant?: string
  }
  fillDeadline?: string
  outputAmount?: string
  inputToken?: AcrossTokenInfo
  outputToken?: AcrossTokenInfo
  id?: string
}

export type AcrossQuote = {
  provider: 'across'
  action: 'quote_bridge'
  sourceChain: AcrossChain
  sourceChainId: number
  destinationChain: AcrossChain
  destinationChainId: number
  inputToken: AcrossTokenInfo
  outputToken: AcrossTokenInfo
  inputAmount: string
  outputAmount: string
  estimatedFillTimeSec?: number
  isAmountTooLow: boolean
  quoteBlock?: string
  quoteTimestamp?: string
  fillDeadline?: string
  spokePoolAddress: `0x${string}`
  destinationSpokePoolAddress: `0x${string}`
  fees: {
    relayFeeTotal?: string
    relayFeePct?: string
    lpFeeTotal?: string
    lpFeePct?: string
    relayerCapitalFeeTotal?: string
    relayerGasFeeTotal?: string
  }
  limits?: AcrossSuggestedFees['limits']
  exclusiveRelayer?: string
  exclusivityDeadline?: number
  quoteId?: string
  executionStatus: 'read_only_quote'
}

function getSupportedChain(chain: string): AcrossChain | undefined {
  return acrossSupportedChains.find(candidate => candidate.toLowerCase() === chain.toLowerCase())
}

function requireChecksummedAddress(field: string, value: string): `0x${string}` {
  if (!isAddress(value)) {
    throw new Error(`${field} must be a valid 0x-prefixed EVM address`)
  }
  return getAddress(value)
}

function requireBaseUnitAmount(amount: string): string {
  const trimmed = amount.trim()
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error('amount must be an integer string in token base units')
  }
  if (BigInt(trimmed) <= 0n) {
    throw new Error('amount must be positive')
  }
  return trimmed
}

function assertPinnedSpokePools(
  quote: AcrossSuggestedFees,
  sourceChain: AcrossChain,
  destinationChain: AcrossChain
): void {
  const expectedSource = getAddress(acrossSpokePools[sourceChain])
  const expectedDestination = getAddress(acrossSpokePools[destinationChain])
  if (
    !quote.spokePoolAddress ||
    !isAddress(quote.spokePoolAddress) ||
    getAddress(quote.spokePoolAddress) !== expectedSource
  ) {
    throw new Error(
      `Across quote returned unexpected source SpokePool for ${sourceChain}: ${quote.spokePoolAddress ?? 'missing'}`
    )
  }
  // Fail-closed: the destination SpokePool MUST be present and match the pinned
  // deployment. A 200 that omits the field (upstream schema drift) must not pass
  // while we surface a locally pinned destination address as "verified".
  if (
    !quote.destinationSpokePoolAddress ||
    !isAddress(quote.destinationSpokePoolAddress) ||
    getAddress(quote.destinationSpokePoolAddress) !== expectedDestination
  ) {
    throw new Error(
      `Across quote returned unexpected destination SpokePool for ${destinationChain}: ${quote.destinationSpokePoolAddress ?? 'missing'}`
    )
  }
}

/**
 * Fetch a read-only Across bridge quote for an Ethereum-origin EVM route.
 *
 * Returns fees, limits, output amount, fill estimate, and pinned-SpokePool
 * verification. Does NOT build calldata, sign, or broadcast — quote-only.
 *
 * @throws if inputs are invalid, the route is unsupported, the upstream quote
 *         fails, the SpokePools don't match the pinned deployments, or no usable
 *         output amount is returned.
 *
 * @example
 * ```ts
 * const quote = await acrossQuote({
 *   sourceChain: 'Base',
 *   destinationChain: 'Arbitrum',
 *   inputToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
 *   outputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
 *   amount: '1000000', // 1 USDC
 * })
 * console.log(quote.outputAmount, quote.fees.relayFeeTotal)
 * ```
 */
export async function acrossQuote(params: AcrossQuoteParams): Promise<AcrossQuote> {
  const sourceChain = getSupportedChain(String(params.sourceChain).trim())
  if (!sourceChain) {
    throw new Error(`sourceChain is not supported by Across. Supported: ${acrossSupportedChains.join(', ')}`)
  }
  if (sourceChain !== ETHEREUM_ORIGIN_CHAIN) {
    throw new Error(`sourceChain must be ${ETHEREUM_ORIGIN_CHAIN} for this Across factory slice`)
  }

  const destinationChain = getSupportedChain(String(params.destinationChain).trim())
  if (!destinationChain) {
    throw new Error(`destinationChain is not supported by Across. Supported: ${acrossSupportedChains.join(', ')}`)
  }
  if (destinationChain === sourceChain) {
    throw new Error('sourceChain and destinationChain must be different')
  }

  const sourceChainId = acrossChainIds[sourceChain]
  const destinationChainId = acrossChainIds[destinationChain]

  const inputToken = requireChecksummedAddress('inputToken', String(params.inputToken).trim())
  const outputToken = requireChecksummedAddress('outputToken', String(params.outputToken).trim())
  const amount = requireBaseUnitAmount(String(params.amount))

  const search = new URLSearchParams({
    inputToken,
    outputToken,
    originChainId: String(sourceChainId),
    destinationChainId: String(destinationChainId),
    amount,
    allowUnmatchedDecimals: String(params.allowUnmatchedDecimals ?? false),
  })
  if (params.to) {
    const recipient = requireChecksummedAddress('to', String(params.to).trim())
    // Fund-safety: reject known burn/dead recipients before forwarding to Across
    // (ported from the mcp-ts `across.ts` source contract — the SDK port had
    // silently dropped this guard). Read-only quote today, but the guard must
    // be in place before any build/sign step is layered on the recipient.
    assertSafeDestination(destinationChain, recipient)
    search.set('recipient', recipient)
  }

  const url = `${ACROSS_API_BASE}/suggested-fees?${search.toString()}`
  const response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Across quote failed: HTTP ${response.status} ${await response.text()}`)
  }
  const quote = (await response.json()) as AcrossSuggestedFees

  assertPinnedSpokePools(quote, sourceChain, destinationChain)

  // A "successful" quote without a usable output amount is a contract-shape
  // failure, not a quote. Reject it rather than emitting a bridge quote with a
  // missing/malformed output so callers never treat absence as success.
  if (typeof quote.outputAmount !== 'string' || !/^[0-9]+$/.test(quote.outputAmount)) {
    throw new Error(`Across quote returned no usable outputAmount: ${quote.outputAmount ?? 'missing'}`)
  }

  return {
    provider: 'across',
    action: 'quote_bridge',
    sourceChain,
    sourceChainId,
    destinationChain,
    destinationChainId,
    inputToken: quote.inputToken ?? { address: inputToken, chainId: sourceChainId },
    outputToken: quote.outputToken ?? { address: outputToken, chainId: destinationChainId },
    inputAmount: amount,
    outputAmount: quote.outputAmount,
    estimatedFillTimeSec: quote.estimatedFillTimeSec,
    isAmountTooLow: quote.isAmountTooLow ?? false,
    quoteBlock: quote.quoteBlock,
    quoteTimestamp: quote.timestamp,
    fillDeadline: quote.fillDeadline,
    spokePoolAddress: getAddress(acrossSpokePools[sourceChain]),
    destinationSpokePoolAddress: getAddress(acrossSpokePools[destinationChain]),
    fees: {
      relayFeeTotal: quote.relayFeeTotal ?? quote.totalRelayFee?.total,
      relayFeePct: quote.relayFeePct ?? quote.totalRelayFee?.pct,
      lpFeeTotal: quote.lpFeeTotal ?? quote.lpFee?.total,
      lpFeePct: quote.lpFeePct ?? quote.lpFee?.pct,
      relayerCapitalFeeTotal: quote.relayerCapitalFee?.total,
      relayerGasFeeTotal: quote.relayerGasFee?.total,
    },
    limits: quote.limits,
    exclusiveRelayer: quote.exclusiveRelayer,
    exclusivityDeadline: quote.exclusivityDeadline,
    quoteId: quote.id,
    executionStatus: 'read_only_quote',
  }
}
