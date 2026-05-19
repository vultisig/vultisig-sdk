import {
  Chain,
  CosmosChain,
  IbcEnabledCosmosChain,
} from '@vultisig/core-chain/Chain'

import { areEqualCoins, CoinKey } from '../../coin/Coin'

const cosmosGasLimitRecord: Record<CosmosChain, bigint> = {
  [Chain.Cosmos]: 200000n,
  [Chain.Osmosis]: 300000n,
  [Chain.Kujira]: 200000n,
  [Chain.Dydx]: 200000n,
  [Chain.Noble]: 200000n,
  [Chain.Akash]: 200000n,
  [Chain.Terra]: 300000n,
  // TerraClassic default covers both bank.MsgSend (uluna ~80k) and
  // ibc.MsgTransfer (~150-200k), with margin for chain load. uusd
  // (USTC) MsgSend has its own 1M override below for the burn-tax /
  // treasury post-handler path; IBC `MsgTransfer` is exempt from the
  // burn tax (per classic-terra/core fee_tax.go::FilterMsgAndComputeTax)
  // so it falls through to this default.
  [Chain.TerraClassic]: 400000n,
  [Chain.THORChain]: 20000000n,
  [Chain.MayaChain]: 2000000000n,
}

export const getCosmosGasLimit = (coin: CoinKey<CosmosChain>): bigint => {
  if (areEqualCoins(coin, { chain: Chain.TerraClassic, id: 'uusd' })) {
    return 1_000_000n
  }

  return cosmosGasLimitRecord[coin.chain]
}

/**
 * Per-chain base gas limits for native Cosmos staking msgs
 * (`MsgDelegate` / `MsgUndelegate` / `MsgBeginRedelegate` /
 * `MsgWithdrawDelegatorReward`). These run measurably hotter than the
 * `getCosmosGasLimit` defaults, which are calibrated for `bank.MsgSend` and
 * `ibc.MsgTransfer`.
 *
 * TerraClassic's classic-terra fork has a known gas-accounting quirk:
 * `MsgDelegate` runs out of gas at almost exactly the requested limit
 * (`gasUsed = gasWanted + ~500`, repeatedly observed at multiple limits).
 * The `ValuePerByte` location in the error points at the gas meter
 * charging for byte writes inside the treasury / tax post-handler, which
 * isn't reflected in the standard SDK gas estimate. The pragmatic fix is
 * a generous over-allocation — fees only pay for `gas_used`, so
 * overestimating costs nothing on success but prevents the failure mode.
 */
const cosmosStakingGasLimitRecord: Record<IbcEnabledCosmosChain, bigint> = {
  [Chain.Cosmos]: 350_000n,
  [Chain.Osmosis]: 400_000n,
  [Chain.Kujira]: 350_000n,
  [Chain.Dydx]: 350_000n,
  [Chain.Noble]: 350_000n,
  [Chain.Akash]: 350_000n,
  [Chain.Terra]: 500_000n,
  [Chain.TerraClassic]: 2_000_000n,
}

type GetCosmosStakingGasLimitInput = {
  chain: IbcEnabledCosmosChain
  /**
   * Number of msgs in the tx body. Bulk `claim_rewards` packs N
   * `MsgWithdrawDelegatorReward` into one tx, one per delegation; each
   * extra msg adds roughly a quarter of the base cost. Defaults to 1,
   * which is correct for delegate / undelegate / redelegate (single-msg).
   */
  msgCount?: number
}

/**
 * Returns the gas limit a Cosmos staking tx should request for the given
 * chain. Overestimating is safe — the chain only charges for `gas_used` —
 * but underestimating runs out of gas mid-execution, so we leave headroom
 * and scale by msg count.
 *
 * `msgCount` must be a finite non-negative integer. `BigInt()` throws a
 * `RangeError` on floats / NaN / Infinity, so guard at the boundary with
 * a clearer message before the conversion.
 */
export const getCosmosStakingGasLimit = ({
  chain,
  msgCount = 1,
}: GetCosmosStakingGasLimitInput): bigint => {
  if (!Number.isInteger(msgCount) || msgCount < 0) {
    throw new Error(
      `getCosmosStakingGasLimit: msgCount must be a non-negative integer, got ${msgCount}`
    )
  }
  const base = cosmosStakingGasLimitRecord[chain]
  const n = BigInt(Math.max(1, msgCount))
  return base + ((n - 1n) * base) / 4n
}
