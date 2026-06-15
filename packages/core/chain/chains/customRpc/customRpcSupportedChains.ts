import { Chain, EvmChain, IbcEnabledCosmosChain } from '@vultisig/core-chain/Chain'

/**
 * Single source of truth for which chains accept an app-wide custom RPC
 * override. Shared by the resolution funnel (EVM / Cosmos URL resolvers) and
 * the Custom RPC UI so the two can never disagree — a chain shown in the picker
 * is exactly a chain the funnel honors.
 *
 * v1 scope is intentionally limited to EVM and the IBC-enabled Cosmos chains,
 * the two groups whose networking resolves through a single per-chain RPC URL.
 * UTXO chains (proxy-only, no coherent node insertion point), the vault-based
 * Cosmos chains (THORChain / MayaChain) and QBTC (a Vultisig proxy with no
 * real-node equivalent) are excluded, mirroring the iOS / Android rationale.
 */
export const customRpcSupportedEvmChains: EvmChain[] = Object.values(EvmChain)

/**
 * Cosmos chains that accept a custom RPC override. The IBC-enabled set excludes
 * the vault-based chains (THORChain / MayaChain) and QBTC by construction.
 */
export const customRpcSupportedCosmosChains: IbcEnabledCosmosChain[] = Object.values(IbcEnabledCosmosChain)

/** All chains that accept a custom RPC override, in display order (EVM then Cosmos). */
export const customRpcSupportedChains: Chain[] = [...customRpcSupportedEvmChains, ...customRpcSupportedCosmosChains]

const supportedChainIds = new Set<string>(customRpcSupportedChains)

/** Whether `chain` accepts an app-wide custom RPC override. */
export const isCustomRpcSupported = (chain: Chain): boolean => supportedChainIds.has(chain)
