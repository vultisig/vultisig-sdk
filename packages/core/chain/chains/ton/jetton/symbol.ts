import { normalizeTokenSymbol } from '@vultisig/core-chain/coin/tokenSymbol'

/**
 * Jetton-named alias of the chain-agnostic `normalizeTokenSymbol`, kept so
 * importers of this subpath keep working. New code should import the shared
 * normalizer from `coin/tokenSymbol` directly.
 */
export const normalizeJettonSymbol = normalizeTokenSymbol
