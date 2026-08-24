import { Chain, CosmosChain, IbcEnabledCosmosChain } from '../../Chain'
import type { CoinKey } from '../../coin/Coin'
import { getFeeAmountFromGasPrice, type ParsedDecimal, parseDecimal } from './cosmosDecimal'
import { cosmosFeeCoinDenom } from './cosmosFeeCoinDenom'
import { getCosmosGasLimit, getCosmosStakingGasLimit } from './cosmosGasLimitRecord'
import { getCosmosRpcUrl } from './getCosmosRpcUrl'
import { getOsmosisDynamicFeeFloor } from './osmosisDynamicFee'

export { getFeeAmountFromGasPrice } from './cosmosDecimal'

/** Canonical signable send-fee floor for IBC-enabled Cosmos chains without a chain-specific override. */
export const COSMOS_SEND_FEE_DEFAULT = 7500n

/** Canonical fixed MayaChain native-send fee in CACAO base units. */
export const MAYA_SEND_FEE_BASE_UNITS = 2000000000n

/**
 * Terra Classic's `uluna` fee at the static 300k gas limit:
 * `300_000 × 28.325 uluna/gas`. 28.325 is the chain's own minimum gas price,
 * live-verifiable at `/terra/tax/v1beta1/params` (`gas_prices[uluna]`), and
 * real columbus-5 sends pay exactly `gas_wanted × 28.325`.
 *
 * This is a derived price, NOT a hand-tuned floor. It previously sat at
 * 20_000_000 (20 LUNC) — 2.35× the chain's requirement — which overcharged
 * every send while ALSO under-covering large ones, because the burn tax it
 * was implicitly absorbing scales with the transfer amount and this constant
 * does not. The burn tax is now added explicitly by the initiator (see
 * `applyTerraClassicBurnTax`), so this is purely the gas component.
 *
 * Matches iOS `TerraClassicTax.ulunaBaseGas` and Android
 * `TerraClassicTax.ULUNA_BASE_GAS`.
 */
export const TERRA_CLASSIC_ULUNA_BASE_GAS = 8_497_500n

/**
 * Terra Classic's `uluna` fee paired with the STAKING gas limit
 * (`getCosmosStakingGasLimit({ chain: TerraClassic })`, currently 4M), priced
 * at the same 28.325 uluna/gas chain minimum as `TERRA_CLASSIC_ULUNA_BASE_GAS`.
 *
 * TerraClassic staking runs ~13x hotter than a native send (4M vs 300k gas),
 * so `TERRA_CLASSIC_ULUNA_BASE_GAS` under-prices it by a wide margin, and a
 * consumer pairing the staking gas limit with the send-fee constant (or any
 * other stale hand-picked LUNC figure) gets a SignDoc the node rejects for
 * insufficient fees before delegate / undelegate / redelegate / withdraw-
 * rewards can execute. Computed from `getCosmosStakingGasLimit` rather than
 * hardcoded so a future retune of the staking gas limit can't silently
 * desync the paired fee the way the gas-limit-only bump in vultisig-sdk#1839
 * originally did.
 */
export const TERRA_CLASSIC_STAKING_ULUNA_FEE_BASE_UNITS = getFeeAmountFromGasPrice(
  getCosmosStakingGasLimit({ chain: Chain.TerraClassic }),
  parseDecimal('28.325')!
)

/**
 * Terra Classic's `uusd` fee at the static 300k gas limit:
 * `300_000 × 0.75 uusd/gas`. USTC bank-denom sends pay both gas and burn
 * tax in `uusd`, so their base cannot reuse the native `uluna` amount.
 *
 * Matches iOS `TerraClassicTax.uusdBaseGas` and Android
 * `TerraClassicTax.UUSD_BASE_GAS`.
 */
export const TERRA_CLASSIC_UUSD_BASE_GAS = 225_000n

export const cosmosGasRecord: Record<IbcEnabledCosmosChain, bigint> = {
  [Chain.Cosmos]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Osmosis]: 9000n,
  [Chain.Kujira]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Terra]: COSMOS_SEND_FEE_DEFAULT,
  [Chain.Dydx]: 2500000000000000n,
  [Chain.TerraClassic]: TERRA_CLASSIC_ULUNA_BASE_GAS,
  [Chain.Noble]: 30000n,
  [Chain.Akash]: 200000n,
}

/**
 * Returns the canonical static native-send fee in base units.
 * THORChain returns `undefined` because its fee must be read from live
 * `native_tx_fee_rune` network data rather than a static fallback.
 */
export const getCosmosSendFeeBaseUnits = (chain: CosmosChain): bigint | undefined => {
  if (chain === Chain.THORChain) return undefined
  if (chain === Chain.MayaChain) return MAYA_SEND_FEE_BASE_UNITS
  return cosmosGasRecord[chain]
}

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
