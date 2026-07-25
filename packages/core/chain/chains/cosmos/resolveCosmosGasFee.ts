/**
 * Resolves the effective Cosmos gas limit and fee amount for a native send,
 * honoring a relayed dynamic `gas_limit` when present.
 *
 * Shared by the signing-inputs resolver (what gets signed) and the fee-display
 * resolver (what the user sees) so the shown and signed fee can never drift —
 * both the gas limit and the fee amount are part of the SignDoc, so every
 * co-signing device MUST resolve them identically.
 *
 * CROSS-PLATFORM CONTRACT — `CosmosSpecific.gas` IS THE FINAL FEE AMOUNT.
 * The initiator prices the fee for the limit it relays (see
 * `priceCosmosFeeForGasLimit`, applied at keysign-payload build time) and every
 * reader spends `gas` verbatim. The Swift clients do exactly this
 * (`TerraHelperStruct` / `CosmosHelperStruct`: `effectiveGasLimit =
 * relayedGasLimit ?? staticGasLimit`, `feeAmount = String(gas)`), so a reader
 * that re-scales `gas` by the limit ratio signs a different SignDoc than its
 * peer, the pre-sign hashes diverge, and the joining device polls
 * `GET /setup-message/{sessionId}` for a hash the initiator never uploaded —
 * failing with "HTTP 404" / "fail to download setup message". That is exactly
 * what a Terra Classic send did across a Swift initiator and a TypeScript
 * co-signer (simulate returns ~320k against a 300k static limit, so the
 * scaling branch was always taken on columbus-5).
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

type PriceCosmosFeeForGasLimitInput = {
  /** per-chain fee amount calibrated for `staticGasLimit` (`getCosmosFeeAmount`) */
  baseFee: bigint
  /** gas limit the tx will actually request (dynamic estimate, else the static limit) */
  gasLimit: bigint
  /** static per-chain gas limit (`getCosmosGasLimit`) the base fee is priced at */
  staticGasLimit: bigint
}

/**
 * Prices a per-chain base fee for the gas limit the tx actually requests.
 *
 * INITIATOR-ONLY. Called once at keysign-payload build time, before the fee is
 * written into `CosmosSpecific.gas`; the result travels in the payload so no
 * co-signer ever recomputes it (see the cross-platform contract above).
 *
 * Scales up with a ceiling in exact integer math when the requested limit
 * exceeds the static one, so chains that price the fee as `gasLimit ×
 * minGasPrice` still clear their ante handler at the bigger limit. At or below
 * the static limit the base fee is returned untouched, keeping the
 * non-dynamic path byte-identical to before dynamic gas existed.
 */
export const priceCosmosFeeForGasLimit = ({
  baseFee,
  gasLimit,
  staticGasLimit,
}: PriceCosmosFeeForGasLimitInput): bigint =>
  gasLimit > staticGasLimit ? (baseFee * gasLimit + staticGasLimit - 1n) / staticGasLimit : baseFee

type ResolveCosmosGasFeeInput = {
  /** final fee amount carried in `CosmosSpecific.gas`, spent verbatim */
  gas: bigint
  /** relayed `CosmosSpecific.gas_limit` (undefined / 0 → use the static limit) */
  relayedGasLimit: bigint | undefined
  /** static per-chain gas limit (`getCosmosGasLimit`) */
  staticGasLimit: bigint
  /**
   * Whether this tx is an IBC transfer (`MsgTransfer`, optionally
   * PFM-forwarded). Applies `IBC_GAS_MULTIPLIER` to both the static gas
   * limit and its matching fee. Defaults to `false` so every other Cosmos
   * message (plain sends, wasm executes, staking) keeps paying the calibrated
   * flat fee — a blanket multiplier on all Cosmos messages would overpay
   * non-IBC sends.
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

  // `gas` is already priced for `relayedGasLimit` by the initiator — re-scaling
  // it here would diverge from every Swift co-signer and break the signature.
  return { resolvedGasLimit, feeAmount: effectiveGas }
}
