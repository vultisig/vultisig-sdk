import { EvmChain } from '@vultisig/core-chain/Chain'

const GWEI = 1_000_000_000n

/**
 * Sanity ceiling (wei) on the RPC-reported maxPriorityFeePerGas, per chain.
 *
 * This is NOT a fee optimizer — it exists solely to catch a compromised or
 * anomalous RPC returning a wildly inflated priority fee (10x-1000x normal)
 * that would otherwise be trusted verbatim into the signed tx and drain the
 * user's balance to gas. Ceilings are deliberately generous — several times
 * above any chain's realistic p99 congestion fee — so legitimate network
 * congestion is never mistaken for an attack and clamped.
 *
 * Sourcing (directional, not a live oracle):
 * - Ethereum L1: priority fees rarely exceed ~50-100 gwei even during heavy
 *   congestion (NFT mints, MEV bursts) -> 500 gwei ceiling, 5-10x margin.
 * - Polygon PoS: gas has historically spiked into the hundreds of gwei
 *   during congestion -> 3,000 gwei ceiling, well above any observed spike.
 * - Rollup L2s (Arbitrum, Base, Blast, Optimism, Zksync, Mantle): sequencer
 *   priority fees are typically ~0-2 gwei -> 50 gwei ceiling. Still 25x+
 *   normal, but tight enough to catch an order-of-magnitude inflation on a
 *   chain where fees are otherwise negligible.
 * - Avalanche C-Chain, BSC, CronosChain, Hyperliquid, Sei, and any future
 *   EVM chain: no well-documented extreme-congestion fee history -> fall
 *   back to the generous default ceiling below.
 */
const priorityFeeCeilingWeiByChain: Partial<Record<EvmChain, bigint>> = {
  [EvmChain.Ethereum]: 500n * GWEI,
  [EvmChain.Polygon]: 3_000n * GWEI,
  [EvmChain.Arbitrum]: 50n * GWEI,
  [EvmChain.Base]: 50n * GWEI,
  [EvmChain.Blast]: 50n * GWEI,
  [EvmChain.Optimism]: 50n * GWEI,
  [EvmChain.Zksync]: 50n * GWEI,
  [EvmChain.Mantle]: 50n * GWEI,
}

const defaultPriorityFeeCeilingWei = 500n * GWEI

/**
 * Clamps an RPC-reported EVM maxPriorityFeePerGas to a generous per-chain
 * sanity ceiling. Never throws — a clamp still lets the tx go through at a
 * safe fee, whereas rejecting it would strand the user mid-flow.
 */
export const clampEvmPriorityFee = (chain: EvmChain, rpcPriorityFeeWei: bigint): bigint => {
  const ceiling = priorityFeeCeilingWeiByChain[chain] ?? defaultPriorityFeeCeilingWei

  if (rpcPriorityFeeWei <= ceiling) {
    return rpcPriorityFeeWei
  }

  console.warn(
    `[evm] RPC-reported maxPriorityFeePerGas for ${chain} (${rpcPriorityFeeWei} wei) exceeds the sanity ceiling (${ceiling} wei); clamping to the ceiling.`
  )

  return ceiling
}
