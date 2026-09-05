import { EvmChain } from '@vultisig/core-chain/Chain'

const GWEI = 1_000_000_000n
const defaultPriorityFeeCeilingWei = 500n * GWEI

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
 * - Rollup L2s (Arbitrum, Base, Blast, Optimism, Zksync, Mantle, Robinhood): sequencer
 *   priority fees are typically ~0-2 gwei -> 50 gwei ceiling. Still 25x+
 *   normal, but tight enough to catch an order-of-magnitude inflation on a
 *   chain where fees are otherwise negligible.
 * - Avalanche C-Chain, BSC, CronosChain, Hyperliquid, and Sei: no
 *   well-documented extreme-congestion fee history -> use the generous
 *   default ceiling below. These entries remain explicit so every new EVM
 *   chain requires a conscious ceiling decision.
 */
const priorityFeeCeilingWeiByChain: Record<EvmChain, bigint> = {
  [EvmChain.Arbitrum]: 50n * GWEI,
  [EvmChain.Base]: 50n * GWEI,
  [EvmChain.Blast]: 50n * GWEI,
  [EvmChain.Optimism]: 50n * GWEI,
  [EvmChain.Zksync]: 50n * GWEI,
  [EvmChain.Mantle]: 50n * GWEI,
  [EvmChain.Robinhood]: 50n * GWEI,
  [EvmChain.Avalanche]: defaultPriorityFeeCeilingWei,
  [EvmChain.CronosChain]: defaultPriorityFeeCeilingWei,
  [EvmChain.BSC]: defaultPriorityFeeCeilingWei,
  [EvmChain.Ethereum]: 500n * GWEI,
  [EvmChain.Polygon]: 3_000n * GWEI,
  [EvmChain.Hyperliquid]: defaultPriorityFeeCeilingWei,
  [EvmChain.Sei]: defaultPriorityFeeCeilingWei,
}

/**
 * Minimum tip (wei) to sign with, per chain. In quiet fee markets the
 * RPC-suggested maxPriorityFeePerGas collapses to near zero (~0.0004 gwei
 * observed on Ethereum L1); on a chain where inclusion is a public tip auction
 * that gives block builders no incentive to include the transaction, so it
 * sits in the mempool until evicted and shows up as "pending then disappeared"
 * on explorers. Tip-auction chains take 1 gwei, Polygon 30 gwei (its
 * validators enforce a ~25 gwei minimum), and OP-stack rollups a nominal
 * 20 wei so the signed field is never literally zero. Chains absent here
 * (Avalanche, Zksync) sign whatever the RPC suggests.
 */
const priorityFeeFloorWeiByChain: Partial<Record<EvmChain, bigint>> = {
  [EvmChain.Ethereum]: 1n * GWEI,
  [EvmChain.BSC]: 1n * GWEI,
  [EvmChain.CronosChain]: 1n * GWEI,
  [EvmChain.Hyperliquid]: 1n * GWEI,
  [EvmChain.Sei]: 1n * GWEI,
  [EvmChain.Polygon]: 30n * GWEI,
  [EvmChain.Base]: 20n,
  [EvmChain.Blast]: 20n,
  [EvmChain.Optimism]: 20n,
}

/**
 * Chains whose sequencer admits transactions first-come-first-served without a
 * tip auction, so any priority fee is money paid for nothing. Signed with a
 * zero tip regardless of what the RPC suggests.
 */
const zeroPriorityFeeChains: EvmChain[] = [EvmChain.Arbitrum, EvmChain.Mantle, EvmChain.Robinhood]

/**
 * Clamps an RPC-reported EVM maxPriorityFeePerGas into a per-chain sane
 * range: zero on chains that ignore the tip, a generous ceiling against a
 * compromised RPC inflating the fee, and a floor (tip-auction chains) against
 * an honest RPC suggesting a tip too low to ever be mined. Never throws — a
 * clamp still lets the tx go through at a safe fee, whereas rejecting it would
 * strand the user mid-flow.
 */
export const clampEvmPriorityFee = (chain: EvmChain, rpcPriorityFeeWei: bigint): bigint => {
  if (zeroPriorityFeeChains.includes(chain)) {
    return 0n
  }

  const ceiling = priorityFeeCeilingWeiByChain[chain]

  if (rpcPriorityFeeWei > ceiling) {
    console.warn(
      `[evm] RPC-reported maxPriorityFeePerGas for ${chain} (${rpcPriorityFeeWei} wei) exceeds the sanity ceiling (${ceiling} wei); clamping to the ceiling.`
    )

    return ceiling
  }

  const floor = priorityFeeFloorWeiByChain[chain] ?? 0n

  if (rpcPriorityFeeWei < floor) {
    return floor
  }

  return rpcPriorityFeeWei
}
