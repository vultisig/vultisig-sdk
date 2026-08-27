import { fromBech32 } from '@cosmjs/encoding'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCosmosWasmSmartQueryUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { rujiraGraphQlEndpoint } from '@vultisig/core-chain/chains/cosmos/thor/rujira/config'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import {
  rujiTradeAsset,
  rujiTradeDefaultSlippageBps,
  rujiTradeQuoteTtlMs,
  rujiTradeRuneBruneMarketContract,
} from '@vultisig/core-chain/swap/general/ruji/config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type FinMarket = {
  address: string
  assetBase: { asset: string }
  assetQuote: { asset: string }
}

type FinGraphQlResponse = {
  data?: { fin?: FinMarket[] }
  errors?: Array<{ message?: string }>
}

type SmartQueryResponse<T> = { data?: T }

type FinConfig = {
  denoms?: string[]
}

type FinSimulation = {
  returned?: string
  fee?: string
}

type RujiTradeAsset = (typeof rujiTradeAsset)[keyof typeof rujiTradeAsset]

const finMarketsQuery = `
  query FinMarkets {
    fin {
      address
      assetBase { asset }
      assetQuote { asset }
    }
  }
`

const getRujiTradeAsset = (coin: AccountCoin): RujiTradeAsset | null => {
  if (coin.chain !== Chain.THORChain) return null

  if (coin.id?.toLowerCase() === rujiTradeAsset.brune.finDenom) {
    return rujiTradeAsset.brune
  }

  if (coin.id === undefined && coin.ticker.toUpperCase() === 'RUNE') {
    return rujiTradeAsset.rune
  }

  return null
}

export const isRujiTradeSwapPair = (from: AccountCoin, to: AccountCoin): boolean => {
  const fromAsset = getRujiTradeAsset(from)
  const toAsset = getRujiTradeAsset(to)

  return !!fromAsset && !!toAsset && fromAsset !== toAsset
}

const assertThorAddress = (address: string, label: string): string => {
  const normalized = address.trim()

  try {
    const decoded = fromBech32(normalized)
    if (decoded.prefix !== 'thor' || (decoded.data.length !== 20 && decoded.data.length !== 32)) {
      throw new Error('wrong prefix')
    }
  } catch {
    throw new Error(`RUJI Trade ${label} must be a valid THORChain address.`)
  }

  return normalized
}

const assertUnsignedInteger = (value: string | undefined, label: string): string => {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`RUJI Trade returned an invalid ${label}.`)
  }

  return value
}

const findFinMarket = async (fromAsset: RujiTradeAsset, toAsset: RujiTradeAsset): Promise<FinMarket> => {
  const response = await queryUrl<FinGraphQlResponse>(rujiraGraphQlEndpoint, {
    body: { query: finMarketsQuery },
  })

  if (response.errors?.length) {
    throw new Error(
      `RUJI Trade market discovery failed: ${response.errors.map(error => error.message ?? 'unknown error').join('; ')}`
    )
  }

  const expected = new Set([fromAsset.quoteAsset.toLowerCase(), toAsset.quoteAsset.toLowerCase()])
  const market = response.data?.fin?.find(candidate => {
    const actual = new Set([candidate.assetBase.asset.toLowerCase(), candidate.assetQuote.asset.toLowerCase()])
    return actual.size === expected.size && [...actual].every(asset => expected.has(asset))
  })

  if (!market) {
    throw new Error(`No RUJI Trade FIN market found for ${fromAsset.quoteAsset} ↔ ${toAsset.quoteAsset}.`)
  }

  const address = assertThorAddress(market.address, 'market contract')
  if (address.toLowerCase() !== rujiTradeRuneBruneMarketContract) {
    throw new Error('RUJI Trade market discovery returned an untrusted RUNE ↔ bRUNE FIN contract.')
  }

  return { ...market, address }
}

const calculateMinimumOutput = (expectedOutput: string, slippageBps: number): string => {
  const minimumOutput = (BigInt(expectedOutput) * BigInt(10_000 - slippageBps)) / 10_000n
  if (minimumOutput <= 0n) {
    throw new Error('RUJI Trade quote is too small to retain a non-zero slippage guard.')
  }

  return minimumOutput.toString()
}

export type GetRujiTradeSwapQuoteInput = {
  from: AccountCoin
  to: AccountCoin
  amount: bigint
  destination: string
  slippageBps?: number
}

export const getRujiTradeSwapQuote = async ({
  from,
  to,
  amount,
  destination,
  slippageBps = rujiTradeDefaultSlippageBps,
}: GetRujiTradeSwapQuoteInput): Promise<GeneralSwapQuote> => {
  const fromAsset = getRujiTradeAsset(from)
  const toAsset = getRujiTradeAsset(to)

  if (!fromAsset || !toAsset || fromAsset === toAsset) {
    throw new Error('RUJI Trade only supports THORChain RUNE ↔ bRUNE swaps.')
  }
  if (amount <= 0n) {
    throw new Error('RUJI Trade swap amount must be greater than zero.')
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) {
    throw new Error('RUJI Trade slippage must be an integer between 0 and 5000 basis points.')
  }
  const sender = assertThorAddress(from.address, 'sender')
  const normalizedDestination = assertThorAddress(destination, 'destination')

  const market = await findFinMarket(fromAsset, toAsset)
  const configUrl = getCosmosWasmSmartQueryUrl({ chain: Chain.THORChain, id: market.address }, { config: {} })
  const simulationUrl = getCosmosWasmSmartQueryUrl(
    { chain: Chain.THORChain, id: market.address },
    { simulate: { denom: fromAsset.finDenom, amount: amount.toString() } }
  )

  const [configResponse, simulationResponse] = await Promise.all([
    queryUrl<SmartQueryResponse<FinConfig>>(configUrl),
    queryUrl<SmartQueryResponse<FinSimulation>>(simulationUrl),
  ])

  const denoms = configResponse.data?.denoms?.map(denom => denom.toLowerCase())
  const expectedDenoms = new Set<string>([rujiTradeAsset.rune.finDenom, rujiTradeAsset.brune.finDenom])
  const actualDenoms = denoms ? new Set(denoms) : undefined
  if (
    !actualDenoms ||
    actualDenoms.size !== expectedDenoms.size ||
    ![...actualDenoms].every(denom => expectedDenoms.has(denom))
  ) {
    throw new Error('RUJI Trade FIN contract config does not match the RUNE ↔ bRUNE market.')
  }

  const expectedOutput = assertUnsignedInteger(simulationResponse.data?.returned, 'simulated output')
  assertUnsignedInteger(simulationResponse.data?.fee, 'protocol fee')
  if (BigInt(expectedOutput) <= 0n) {
    throw new Error('RUJI Trade returned a zero-output quote.')
  }

  const executeMsg = JSON.stringify({
    swap: {
      min: {
        min_return: calculateMinimumOutput(expectedOutput, slippageBps),
        to: normalizedDestination,
      },
    },
  })

  return {
    dstAmount: expectedOutput,
    provider: 'ruji',
    expiresAt: Date.now() + rujiTradeQuoteTtlMs,
    tx: {
      cosmosWasm: {
        sender,
        contract: market.address,
        executeMsg,
        funds: [{ denom: fromAsset.finDenom, amount: amount.toString() }],
      },
    },
  }
}
