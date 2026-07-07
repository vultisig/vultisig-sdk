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
type ResolveCosmosGasFeeInput = {
  /** static per-chain fee amount already stored in `CosmosSpecific.gas` */
  gas: bigint
  /** relayed `CosmosSpecific.gas_limit` (undefined / 0 → use the static limit) */
  relayedGasLimit: bigint | undefined
  /** static per-chain gas limit (`getCosmosGasLimit`) */
  staticGasLimit: bigint
}

type ResolveCosmosGasFeeResult = {
  resolvedGasLimit: bigint
  feeAmount: bigint
}

export const resolveCosmosGasFee = ({
  gas,
  relayedGasLimit,
  staticGasLimit,
}: ResolveCosmosGasFeeInput): ResolveCosmosGasFeeResult => {
  const resolvedGasLimit = relayedGasLimit && relayedGasLimit > 0n ? relayedGasLimit : staticGasLimit

  const feeAmount =
    resolvedGasLimit > staticGasLimit ? (gas * resolvedGasLimit + staticGasLimit - 1n) / staticGasLimit : gas

  return { resolvedGasLimit, feeAmount }
}
