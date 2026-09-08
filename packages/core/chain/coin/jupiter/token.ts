import { Chain } from '@vultisig/core-chain/Chain'
import { Coin } from '@vultisig/core-chain/coin/Coin'

/** One entry of Jupiter's Token API v2, as returned by its search and tag endpoints. */
export type SolanaJupiterToken = {
  id: string
  name: string
  symbol: string
  decimals: number
  icon?: string
  /** Jupiter's own verification flag; `null` for a mint it indexes but does not vouch for. */
  isVerified?: boolean | null
  tags?: string[]
}

type FromSolanaJupiterTokensInput = {
  tokens: SolanaJupiterToken[]
  chain: Chain
}

export const fromSolanaJupiterTokens = ({ tokens, chain }: FromSolanaJupiterTokensInput): Coin[] => {
  return tokens
    .filter(token => !!token.icon) // Ensure only tokens with logos are included
    .map(token => ({
      chain,
      id: token.id,
      decimals: token.decimals,
      logo: token.icon || '',
      ticker: token.symbol,
    }))
}
