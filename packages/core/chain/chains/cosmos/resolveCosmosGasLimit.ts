/**
 * Cosmos gas-limit resolution, and the initiator-side helper that prices a fee
 * amount against a chosen limit.
 *
 * WIRE CONTRACT (commondata `CosmosSpecific`, vultisig/commondata#93):
 *   - field 3 `gas`       — the fee AMOUNT. Signed VERBATIM by every co-signer.
 *   - field 7 `gas_limit`  — the per-tx gas limit. When unset, peers fall back
 *                            to the static per-chain limit.
 *
 * Both fields are part of the SignDoc, so every co-signing device MUST derive
 * them identically or the MPC signature fails. The only way to guarantee that
 * across independent implementations is for the read side to do NO arithmetic:
 * whatever the initiator wrote is what gets signed. iOS (`TerraHelperStruct` /
 * `CosmosHelperStruct.defaultFee`), Android (`TerraHelper`) and this SDK's own
 * QBTC builder (`QBTCHelper`) all follow that rule.
 *
 * A previous version of this module rescaled `gas` on the READ side by
 * `relayedGasLimit / staticGasLimit`. That silently redefined field 3 in one
 * client: on a TerraClassic send the extension signed a fee of 21.465267 LUNC
 * while iOS signed the payload's 20 LUNC, the two SignDocs diverged, and the
 * keysign never completed. Any fee headroom must therefore be applied by the
 * INITIATOR (see `scaleCosmosFeeAmount`) before it is written to `gas`.
 */

/**
 * COSMOS-02: an IBC transfer (ICS-20 `MsgTransfer`, optionally PFM-forwarded
 * via memo) does measurably more work on the source leg than a plain bank
 * send — channel-state writes plus a relayer event — so the flat per-chain
 * limit (calibrated for `MsgSend`) is undersized and can run out of gas
 * mid-execution: the fee is spent, the transfer fails, and funds don't move
 * but the fee is still burned. PFM hops are budgeted by each forwarding
 * chain, not the source leg here, so ×2 headroom on the source leg is
 * sufficient.
 *
 * Applied by the initiator, which relays the widened limit in `gas_limit` and
 * prices `gas` for it — never by the read side, which has no proto field to
 * carry a multiplier and so could not stay in lockstep with iOS / Android.
 */
export const IBC_GAS_MULTIPLIER = 2n

type ResolveCosmosGasLimitInput = {
  /** relayed `CosmosSpecific.gas_limit` (undefined / 0 → use the static limit) */
  relayedGasLimit: bigint | undefined
  /** static per-chain gas limit (`getCosmosGasLimit`) */
  staticGasLimit: bigint
}

/**
 * The gas limit to sign: the relayed per-tx limit when an initiator set one,
 * else the static per-chain limit.
 *
 * `0n` is treated as unset. Proto field 7 is `optional uint64`, but a producer
 * can still relay a nonsensical 0, and signing `gas_wanted = 0` would be
 * rejected on-chain. Mirrors iOS `relayedGasLimit ?? config.gasLimit` and the
 * same guard in `buildQBTCAuthInfo`.
 */
export const resolveCosmosGasLimit = ({ relayedGasLimit, staticGasLimit }: ResolveCosmosGasLimitInput): bigint =>
  relayedGasLimit && relayedGasLimit > 0n ? relayedGasLimit : staticGasLimit

type ScaleCosmosFeeAmountInput = {
  /** fee amount priced at `fromGasLimit` */
  feeAmount: bigint
  /** the gas limit `feeAmount` was calibrated for (the static per-chain limit) */
  fromGasLimit: bigint
  /** the gas limit that will actually be signed */
  toGasLimit: bigint
}

/**
 * `ceil(feeAmount × toGasLimit / fromGasLimit)` in exact integer arithmetic.
 *
 * INITIATOR-ONLY. Chains that price their fee per unit of gas (Terra Classic,
 * dYdX) set the static amount to exactly `staticGasLimit × minGasPrice`, so a
 * widened gas limit needs a proportionally widened fee or the ante handler
 * rejects the tx with "insufficient fee". Scaling the known-good static amount
 * by the limit ratio yields `ceil(toGasLimit × minGasPrice)` without hardcoding
 * each chain's price — the price is implicit in the static amount.
 *
 * Runs once, on the device that builds the payload; the result is written to
 * `CosmosSpecific.gas` and every co-signer reads it verbatim. Mirrors iOS
 * `CosmosGasPricedFee.scaled` and Android `TerraClassicTax.baseGas`.
 *
 * Returns `feeAmount` unchanged when the limit is unchanged or `fromGasLimit`
 * is 0, so the non-dynamic path stays byte-identical.
 */
export const scaleCosmosFeeAmount = ({ feeAmount, fromGasLimit, toGasLimit }: ScaleCosmosFeeAmountInput): bigint => {
  if (fromGasLimit <= 0n || toGasLimit === fromGasLimit) return feeAmount

  return (feeAmount * toGasLimit + fromGasLimit - 1n) / fromGasLimit
}
