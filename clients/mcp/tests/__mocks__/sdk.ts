export const Chain = {
  Ethereum: 'Ethereum',
  Bitcoin: 'Bitcoin',
  Solana: 'Solana',
  THORChain: 'THORChain',
  Avalanche: 'Avalanche',
  BSC: 'BSC',
  Polygon: 'Polygon',
  Optimism: 'Optimism',
  Arbitrum: 'Arbitrum',
  Base: 'Base',
} as any

export class Vultisig {}
export class MemoryStorage {}
export type VaultBase = any

export { resolveChainReference } from '../../../../packages/sdk/src/utils/resolveChainReference'
// sdk#1819: the canonical chain[:token] grammar parser the client now delegates to.
// Re-exported from source (like resolveChainReference above) rather than stubbed, so the
// tests exercise the real rejection behaviour instead of a hand-written approximation.
export { splitAssetRef } from '../../../../packages/sdk/src/tools/parse/assetRef'
