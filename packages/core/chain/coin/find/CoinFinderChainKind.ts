export const coinFinderChainKinds = ['evm', 'cosmos', 'solana', 'cardano'] as const
export type CoinFinderChainKind = (typeof coinFinderChainKinds)[number]
