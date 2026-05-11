/**
 * Static registry of well-known EVM contract addresses with human-readable
 * labels. Used by transaction-intent display to label both the recipient
 * (`tx.to`) of a contract call and address-typed arguments such as the
 * `spender` in `approve(address,uint256)`.
 *
 * Layering for transaction-intent display:
 *
 *   1. Blockaid simulation may already attribute well-known contracts in its
 *      `transaction_actions` / `address_validation` payloads — especially
 *      malicious or sanctioned addresses. Run that first when available.
 *
 *   2. This static table — offline fast-path for the long tail of well-known
 *      routers, aggregators, and protocol entry points the user is likely
 *      interacting with on a healthy chain. Resolves instantly with no
 *      network round-trip.
 *
 * Addresses are normalized to lowercase. Keys must be 0x-prefixed 40-hex-char
 * strings (the canonical EIP-55 checksum form is lowercased here for stable
 * lookup; callers may pass any casing).
 *
 * Chain scoping: many DEX/aggregator deployments use deterministic CREATE2
 * addresses and live at the same address across every EVM chain. Such
 * entries omit `chains`. Entries that are tied to a specific deployment
 * include `chains` so the lookup helper can filter when the caller knows
 * which chain the transaction is on.
 */

import type { EvmChain } from '../../../Chain'

export type KnownEvmContractCategory =
  | 'DEX Router'
  | 'DEX Aggregator'
  | 'Token Approval Helper'
  | 'Cross-Chain Bridge'
  | 'Lending Protocol'
  | 'NFT Marketplace'

export type KnownEvmContract = {
  label: string
  category: KnownEvmContractCategory
  /**
   * If present, the entry is only valid on these chains. Omit for entries
   * whose canonical deployment uses the same address on every EVM chain
   * (deterministic CREATE2 deploys).
   */
  chains?: ReadonlyArray<EvmChain>
}

export const knownEvmContracts: Readonly<Record<string, KnownEvmContract>> = {
  // Uniswap V2 Router (UniswapV2Router02). Ethereum mainnet only — the V2
  // contract was never re-deployed by Uniswap to other chains.
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': {
    label: 'Uniswap V2 Router',
    category: 'DEX Router',
    chains: ['Ethereum'],
  },

  // Uniswap V3 SwapRouter (legacy, "Router1"). Valid for the deployments
  // listed below; do NOT assume the same address across every EVM chain —
  // Uniswap's deployment docs explicitly warn router addresses can differ.
  '0xe592427a0aece92de3edee1f18e0157c05861564': {
    label: 'Uniswap V3 Router',
    category: 'DEX Router',
    chains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon'],
  },

  // Uniswap V3 SwapRouter02. Valid for these deployments. Base uses a
  // different SwapRouter02 address — see the entry below.
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': {
    label: 'Uniswap V3 SwapRouter02',
    category: 'DEX Router',
    chains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon'],
  },

  // Uniswap V3 SwapRouter02 — Base deployment (per Uniswap's Base contracts
  // page).
  '0x2626664c2603336e57b271c5c0b26f421741e481': {
    label: 'Uniswap V3 SwapRouter02',
    category: 'DEX Router',
    chains: ['Base'],
  },

  // 1inch Aggregation Router V5. Same address on most supported chains, but
  // not zkSync Era (different V5 router) — left unscoped because we don't
  // currently route on zkSync; tighten if that changes.
  '0x1111111254eeb25477b68fb85ed929f73a960582': {
    label: '1inch V5 Router',
    category: 'DEX Aggregator',
  },

  // 1inch Aggregation Router V6.
  '0x111111125421ca6dc452d289314280a0f8842a65': {
    label: '1inch V6 Router',
    category: 'DEX Aggregator',
  },

  // Uniswap Permit2 — universal token-approval helper used by Universal
  // Router and many other integrators. Deployed at the same address on every
  // EVM chain Uniswap currently lists; left unscoped on that basis.
  '0x000000000022d473030f116ddee9f6b43ac78ba3': {
    label: 'Permit2',
    category: 'Token Approval Helper',
  },

  // THORChain Router on Ethereum mainnet (deposit entry point for
  // cross-chain swaps).
  '0xd37bbe5744d730a1d98d8dc97c42f0ca46ad7146': {
    label: 'THORChain Router',
    category: 'Cross-Chain Bridge',
    chains: ['Ethereum'],
  },

  // Aave V3 Pool on Ethereum mainnet.
  '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2': {
    label: 'Aave V3 Pool',
    category: 'Lending Protocol',
    chains: ['Ethereum'],
  },
}

export type LookupKnownEvmContractOptions = {
  /**
   * Chain the transaction is on. When omitted the lookup ignores any
   * chain-scoping on entries (best-effort labeling). When supplied, entries
   * with a `chains` filter only match if the chain is in that list.
   */
  chain?: EvmChain
}

export const lookupKnownEvmContract = (
  address: string,
  options?: LookupKnownEvmContractOptions
): KnownEvmContract | null => {
  const entry = knownEvmContracts[address.toLowerCase()]
  if (!entry) {
    return null
  }
  if (options?.chain && entry.chains && !entry.chains.includes(options.chain)) {
    return null
  }
  return entry
}
