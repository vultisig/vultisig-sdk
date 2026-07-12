/**
 * Resolves the effective Cosmos gas limit and fee amount for a native send,
 * honoring a relayed dynamic `gas_limit` when present.
 *
 * Shared by the signing-inputs resolver (what gets signed) and the fee-display
 * resolver (what the user sees) so the shown and signed fee can never drift —
 * the gas limit is part of the SignDoc, so both sides MUST agree.
 *
 * When the relayed limit exceeds the static per-chain limit, the fee amount is
 * scaled proportionally with a ceiling (exact integer math) so the tx pays for
 * the extra gas. Below or equal to the static limit, both values are left
 * untouched, keeping the non-dynamic path byte-identical.
 */

/**
 * COSMOS-02: an IBC transfer (ICS-20 `MsgTransfer`, optionally PFM-forwarded
 * via memo) does measurably more work on the source leg than a plain bank
 * send — channel-state writes plus a relayer event — so the flat per-chain
 * limit (calibrated for `MsgSend`) is undersized and can run out of gas
 * mid-execution: the fee is spent, the transfer fails, and funds don't move
 * but the fee is still burned. PFM hops are budgeted by each forwarding
 * chain, not the source leg here, so ×2 headroom on the source leg is
 * sufficient. Mirrors the app's own `IBC_GAS_MULTIPLIER`
 * (vultiagent-app/src/services/cosmosTx.ts).
 */
export const IBC_GAS_MULTIPLIER = 2n

type ResolveCosmosGasFeeInput = {
  /** static per-chain fee amount already stored in `CosmosSpecific.gas` */
  gas: bigint
  /** relayed `CosmosSpecific.gas_limit` (undefined / 0 → use the static limit) */
  relayedGasLimit: bigint | undefined
  /** static per-chain gas limit (`getCosmosGasLimit`) */
  staticGasLimit: bigint
  /**
   * Whether this tx is an IBC transfer (`MsgTransfer`, optionally
   * PFM-forwarded). Applies `IBC_GAS_MULTIPLIER` to both the static gas
   * limit and its matching fee before resolving against a relayed limit.
   * Defaults to `false` so every other Cosmos message (plain sends, wasm
   * executes, staking) keeps paying the calibrated flat fee — a blanket
   * multiplier on all Cosmos messages would overpay non-IBC sends.
   */
  isIbcTransfer?: boolean
}

type ResolveCosmosGasFeeResult = {
  resolvedGasLimit: bigint
  feeAmount: bigint
}

export const resolveCosmosGasFee = ({
  gas,
  relayedGasLimit,
  staticGasLimit,
  isIbcTransfer = false,
}: ResolveCosmosGasFeeInput): ResolveCosmosGasFeeResult => {
  const effectiveStaticGasLimit = isIbcTransfer ? staticGasLimit * IBC_GAS_MULTIPLIER : staticGasLimit
  const effectiveGas = isIbcTransfer ? gas * IBC_GAS_MULTIPLIER : gas

  const resolvedGasLimit = relayedGasLimit && relayedGasLimit > 0n ? relayedGasLimit : effectiveStaticGasLimit

  const feeAmount =
    resolvedGasLimit > effectiveStaticGasLimit
      ? (effectiveGas * resolvedGasLimit + effectiveStaticGasLimit - 1n) / effectiveStaticGasLimit
      : effectiveGas

  return { resolvedGasLimit, feeAmount }
}
