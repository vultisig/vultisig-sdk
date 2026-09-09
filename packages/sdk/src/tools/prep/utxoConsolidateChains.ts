import { UtxoChain } from '@vultisig/core-chain/Chain'

/** Chains supported by the plain UTXO consolidation envelope. */
export const CONSOLIDATE_CHAINS = [
  UtxoChain.Bitcoin,
  UtxoChain.Litecoin,
  UtxoChain.Dogecoin,
  UtxoChain.BitcoinCash,
  UtxoChain.Dash,
] as const

export type ConsolidateChain = (typeof CONSOLIDATE_CHAINS)[number]
