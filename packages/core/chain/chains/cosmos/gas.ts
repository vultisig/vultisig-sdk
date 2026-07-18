import { Chain, CosmosChain, IbcEnabledCosmosChain } from '../../Chain'
import type { CoinKey } from '../../coin/Coin'
import { getFeeAmountFromGasPrice, type ParsedDecimal, parseDecimal } from './cosmosDecimal'
import { cosmosFeeCoinDenom } from './cosmosFeeCoinDenom'
import { getCosmosGasLimit } from './cosmosGasLimitRecord'
import { getCosmosRpcUrl } from './getCosmosRpcUrl'
import { getOsmosisDynamicFeeFloor } from './osmosisDynamicFee'

export { getFeeAmountFromGasPrice } from './cosmosDecimal'

export const COSMOS_SEND_FEE_DEFAULT = 7500n

export const cosmosGasRecord: Record<IbcEnabledCosmosChain, bigint> = {
  [Chain.Cosmos]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Osmosis]: 9000n,
  [Chain.Kujira]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Terra]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Dydx]: 2500000000000000n,
  [Chain.TerraClassic]: 20000000n,
  [Chain.Noble]: 30000n,
  [Chain.Akash]: 200000n,
}

/**
 * Return the canonical signable native-send fee floor for a Cosmos-family
 * chain. IBC-enabled chains use their exact static floor from
 * `cosmosGasRecord`; vault-based chains (THORChain / MayaChain) fall back to
 * the shared Cosmos Hub default because they do not participate in the
 * `getCosmosFeeAmount()` live-fee path and do not publish a higher fixed send
 * floor here.
 */
export const getCosmosSendFeeBaseUnits = (chain: CosmosChain): bigint =>
  chain in cosmosGasRecord
    ? cosmosGasRecord[chain as IbcEnabledCosmosChain]
    : COSMOS_SEND_FEE_DEFAULT

type FetchOpts = {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

type CosmosNodeConfigResponse = {
  minimum_gas_price?: string
}

const minGasPriceConfigPath = '/cosmos/base/node/v1beta1/config'
const minGasPriceFetchTimeoutMs = 3_000
const maxLiveFeeMultiplier = 10n

const parseMinGasPriceEntry = (entry: string) => {
  const match = entry.trim().match(/^(\d+(?:\.\d+)?)([a-zA-Z][a-zA-Z0-9/._:-]*)$/)
  if (!match) return undefined

  const [, amount, denom] = match
  const decimal = parseDecimal(amount)
  if (!decimal) return undefined

  return { ...decimal, denom }
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
