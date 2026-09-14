import { EvmChain } from '@vultisig/core-chain/Chain'

/**
 * Per-chain minimum EVM gas pricing (wei), keyed by `EvmChain`.
 *
 * Chains absent from this table have no known evidence they need one — their
 * fee markets clear without a protocol-level minimum (no floor is the safe
 * default; an unfloored fee only under-quotes on those chains if a wallet's
 * own RPC sampling is broken, which this table doesn't defend against).
 *
 * Single source of truth: this table used to be hand-copied between
 * `vultiagent-app`'s `MIN_PRIORITY_FEE_BY_CHAIN`/`MIN_MAX_FEE_BY_CHAIN`
 * (src/services/evmTx.ts) and `agent-backend-ts`'s `GAS_FLOORS_WEI`
 * (src/mastra/tools/mcp/tools/evm/evm-tx-info.ts), synced by comment rather
 * than import — the app's copy had already drifted (missing an Ethereum
 * entry abts carries). Values below are sourced from abts's `GAS_FLOORS_WEI`
 * as of 2026-07, the more complete of the two copies (vultisig-sdk#1351).
 *
 * This is a distinct concern from `clampEvmPriorityFee` in this same
 * directory: that one clamps an RPC-*reported* priority fee against a sanity
 * ceiling/floor on the SDK's own signing path. This table floors a
 * client/server-computed fee *before* it reaches an RPC-backed estimate at
 * all (e.g. a stuck-tx replacement, or a server envelope that omitted gas
 * pricing) — the two tables aren't required to agree and this change doesn't
 * touch `clampEvmPriorityFee`.
 *
 * Over-floor direction only: every value here can only raise an
 * under-priced fee, never lower a correctly-priced one.
 */
export const EVM_GAS_FLOOR_WEI: Partial<Record<EvmChain, { basePerGas: bigint; priorityPerGas: bigint }>> = {
  Sei: { basePerGas: 1_500_000_000n, priorityPerGas: 100_000_000n }, // 1.5 gwei / 0.1 gwei
  Hyperliquid: { basePerGas: 1_000_000_000n, priorityPerGas: 100_000_000n }, // 1 gwei / 0.1 gwei
  Arbitrum: { basePerGas: 100_000_000n, priorityPerGas: 10_000_000n }, // 0.1 gwei / 0.01 gwei
  Optimism: { basePerGas: 100_000_000n, priorityPerGas: 1_000_000n }, // 0.1 gwei / 0.001 gwei
  Base: { basePerGas: 100_000_000n, priorityPerGas: 1_000_000n }, // 0.1 gwei / 0.001 gwei
  Mantle: { basePerGas: 100_000_000n, priorityPerGas: 1_000_000n }, // 0.1 gwei / 0.001 gwei
  BSC: { basePerGas: 1_000_000_000n, priorityPerGas: 3_000_000_000n }, // 1 gwei / 3 gwei
  Polygon: { basePerGas: 1_000_000_000n, priorityPerGas: 30_000_000_000n }, // 1 gwei / 30 gwei
  Ethereum: { basePerGas: 1_000_000_000n, priorityPerGas: 1_000_000_000n }, // 1 gwei / 1 gwei
}

/**
 * `basePerGas + priorityPerGas` floor for a chain, or `undefined` when the
 * chain has no floor. Matches `MIN_MAX_FEE_BY_CHAIN`'s derivation in the
 * app's copy — kept as a helper here so consumers don't re-derive it.
 */
export const getEvmMaxFeeFloorWei = (chain: EvmChain): bigint | undefined => {
  const floor = EVM_GAS_FLOOR_WEI[chain]
  return floor ? floor.basePerGas + floor.priorityPerGas : undefined
}
