// Canonical yield.xyz / StakeKit network-slug -> Vultisig chain mapping.
//
// Previously duplicated as two private switch tables (`yieldNetworkToCanonicalChain`
// in index.ts, `yieldNetworkToEvmChain` in stakekitApi.ts) that had to be kept in
// sync by hand — the EVM-only table was already missing nothing today, but the
// two tables are exactly the "duplicated-not-imported" drift class the SDK is
// meant to close off (sdk#1953). Both call sites now import from here.

/** EVM-family yield.xyz network slugs. Mirrors mcp-ts's EVM_NETWORKS. */
export const YIELD_EVM_NETWORK_SLUGS = new Set([
  'ethereum',
  'arbitrum',
  'base',
  'optimism',
  'polygon',
  'avalanche-c',
  'binance',
  'cronos',
  'zksync',
  'sei',
])

/**
 * Map a yield.xyz network slug to the PascalCase chain name the app uses everywhere.
 * Mirrors mcp-ts's `yieldNetworkToCanonicalChain`. Covers EVM and non-EVM networks.
 */
export function yieldNetworkToCanonicalChain(network: string): string | null {
  switch (network) {
    case 'ethereum':
      return 'Ethereum'
    case 'arbitrum':
      return 'Arbitrum'
    case 'base':
      return 'Base'
    case 'optimism':
      return 'Optimism'
    case 'polygon':
      return 'Polygon'
    case 'avalanche-c':
      return 'Avalanche'
    case 'binance':
      return 'BSC'
    case 'cronos':
      return 'CronosChain'
    case 'zksync':
      return 'Zksync'
    case 'sei':
      return 'Sei'
    case 'solana':
      return 'Solana'
    case 'sui':
      return 'Sui'
    case 'tron':
      return 'Tron'
    case 'ton':
      return 'Ton'
    default:
      return null
  }
}

/**
 * Map a yield.xyz network slug to its PascalCase EVM chain name, or `null` for
 * a non-EVM (or unrecognized) network. Callers that build an EVM-shaped scan
 * request (flat `{to, value, data}`, no `tx_encoding`) must use this, not the
 * broader `yieldNetworkToCanonicalChain` — a non-EVM network has to fail
 * closed here rather than fall through into EVM calldata parsing.
 */
export function yieldNetworkToEvmChain(network: string): string | null {
  return YIELD_EVM_NETWORK_SLUGS.has(network) ? yieldNetworkToCanonicalChain(network) : null
}
