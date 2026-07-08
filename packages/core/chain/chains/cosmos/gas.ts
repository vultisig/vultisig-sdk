import { Chain, IbcEnabledCosmosChain } from '../../Chain'
import type { CoinKey } from '../../coin/Coin'
import { cosmosFeeCoinDenom } from './cosmosFeeCoinDenom'
import { getCosmosGasLimit } from './cosmosGasLimitRecord'
import { getCosmosRpcUrl } from './getCosmosRpcUrl'
import { getOsmosisDynamicFeeFloor } from './osmosisDynamicFee'

const defaultGas = 7500n

export const cosmosGasRecord: Record<IbcEnabledCosmosChain, bigint> = {
  [Chain.Cosmos]: defaultGas,
  [Chain.Osmosis]: 9000n,
  [Chain.Kujira]: defaultGas,
  [Chain.Terra]: defaultGas,
  [Chain.Dydx]: 2500000000000000n,
  [Chain.TerraClassic]: 20000000n,
  [Chain.Noble]: 30000n,
  [Chain.Akash]: 200000n,
}

type FetchOpts = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

type CosmosNodeConfigResponse = {
  minimum_gas_price?: string
}

type ParsedDecimal = {
  numerator: bigint
  denominator: bigint
}

const minGasPriceConfigPath = '/cosmos/base/node/v1beta1/config'
const minGasPriceFetchTimeoutMs = 3_000
const maxLiveFeeMultiplier = 10n

const parseDecimal = (value: string): ParsedDecimal | undefined => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined

  const [whole, fraction = ''] = value.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  const numerator = BigInt(`${whole}${fraction}`)

  return { numerator, denominator }
}

const parseMinGasPriceEntry = (entry: string) => {
  const match = entry.trim().match(/^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9/._:-]*)$/)
  if (!match) return undefined

  const [, amount, denom] = match
  const decimal = parseDecimal(amount)
  if (!decimal) return undefined

  return { ...decimal, denom }
}

export const getFeeAmountFromGasPrice = (gasLimit: bigint, gasPrice: ParsedDecimal): bigint => {
  const total = gasLimit * gasPrice.numerator

  return (total + gasPrice.denominator - 1n) / gasPrice.denominator
}

export const getMinGasPriceForDenom = (minimumGasPrice: string, targetDenom: string): ParsedDecimal | undefined => {
  for (const entry of minimumGasPrice.split(',')) {
    const parsed = parseMinGasPriceEntry(entry)
    if (parsed?.denom.toLowerCase() === targetDenom.toLowerCase()) {
      return {
        numerator: parsed.numerator,
        denominator: parsed.denominator,
      }
    }
  }

  return undefined
}

const getTimeoutController = (signal?: AbortSignal) => {
  const controller = new AbortController()

  const abort = () => controller.abort()
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener('abort', abort, { once: true })
  }

  return {
    controller,
    cleanup: () => {
      signal?.removeEventListener('abort', abort)
    },
  }
}

const fetchMinGasPrice = async (chain: IbcEnabledCosmosChain, { fetchImpl = fetch, signal }: FetchOpts = {}) => {
  const timeoutController = getTimeoutController(signal)
  const timeout = setTimeout(() => timeoutController.controller.abort(), minGasPriceFetchTimeoutMs)
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    const rejectTimeout = () =>
      reject(new Error(`Cosmos min gas config request timed out after ${minGasPriceFetchTimeoutMs}ms`))
    if (timeoutController.controller.signal.aborted) {
      rejectTimeout()
      return
    }

    timeoutController.controller.signal.addEventListener('abort', rejectTimeout, { once: true })
  })

  try {
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(`${getCosmosRpcUrl(chain)}${minGasPriceConfigPath}`, {
          signal: timeoutController.controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Cosmos ${chain} min gas config request failed: ${response.status}`)
        }

        const data = (await response.json()) as CosmosNodeConfigResponse

        return data.minimum_gas_price ?? ''
      })(),
      timeoutPromise,
    ])
  } finally {
    clearTimeout(timeout)
    timeoutController.cleanup()
  }
}

const getGenericCosmosFeeAmount = async (coin: CoinKey<IbcEnabledCosmosChain>, opts: FetchOpts): Promise<bigint> => {
  const floor = cosmosGasRecord[coin.chain]

  try {
    const minimumGasPrice = await fetchMinGasPrice(coin.chain, opts)
    const gasPrice = getMinGasPriceForDenom(minimumGasPrice, cosmosFeeCoinDenom[coin.chain])
    if (!gasPrice) return floor

    const computedFee = getFeeAmountFromGasPrice(getCosmosGasLimit(coin), gasPrice)
    if (computedFee > floor * maxLiveFeeMultiplier) return floor

    return computedFee > floor ? computedFee : floor
  } catch {
    return floor
  }
}

export const getCosmosFeeAmount = async (
  coin: CoinKey<IbcEnabledCosmosChain>,
  opts: FetchOpts = {}
): Promise<bigint> => {
  if (coin.chain !== Chain.Osmosis) return getGenericCosmosFeeAmount(coin, opts)

  // Osmosis's real fee floor is enforced by its EIP-1559 `x/txfees` module,
  // NOT the generic node-config `minimum-gas-price` (a per-node/operator-
  // configurable value that doesn't track the live protocol floor, and can
  // be clamped away by the anomaly guard above when it legitimately spikes).
  // Run both lookups concurrently (each has its own timeout budget) rather
  // than sequentially, and never pay less than the higher of the two -
  // see osmosisDynamicFee.ts.
  const [genericFee, dynamicFloor] = await Promise.all([
    getGenericCosmosFeeAmount(coin, opts),
    getOsmosisDynamicFeeFloor(getCosmosGasLimit(coin), opts),
  ])
  return dynamicFloor !== null && dynamicFloor > genericFee ? dynamicFloor : genericFee
}
