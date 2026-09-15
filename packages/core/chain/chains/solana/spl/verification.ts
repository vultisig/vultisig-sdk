import { getJupiterTokens } from '@vultisig/core-chain/coin/jupiter/api'
import { normalizeTokenSymbol } from '@vultisig/core-chain/coin/tokenSymbol'
import { TokenVerification } from '@vultisig/core-chain/coin/tokenVerification'
import { attempt } from '@vultisig/lib-utils/attempt'

import { getSolanaVerifiedTokenRegistry, SolanaVerifiedTokenRegistry } from './verifiedRegistry'

type ResolveSolanaTokenVerificationInput = {
  /** Mint address. */
  address: string
  symbol?: string
  name?: string
  /** Jupiter's own verification flag for the mint, when known. */
  isVerified?: boolean | null
  registry: SolanaVerifiedTokenRegistry
}

/**
 * Classifies a mint against the verified registry. A listed mint is `verified`
 * whatever it calls itself, and so is one Jupiter itself marks verified — that
 * covers a listing newer than the registry's hourly refresh and the degraded,
 * curated-only registry. An unlisted mint is `scam` when its symbol or name
 * collapses (see `normalizeTokenSymbol`) onto a verified token's symbol or
 * name — the fake-USDT pattern, where the counterfeit is only distinguishable
 * by address. Anything else is `unverified`.
 */
export const resolveSolanaTokenVerification = ({
  address,
  symbol,
  name,
  isVerified,
  registry,
}: ResolveSolanaTokenVerificationInput): TokenVerification => {
  if (registry.byAddress[address] || isVerified) return 'verified'

  const impersonates = [symbol, name].some(label => {
    const skeleton = label ? normalizeTokenSymbol(label) : ''

    return !!skeleton && (registry.symbols.has(skeleton) || registry.names.has(skeleton))
  })

  return impersonates ? 'scam' : 'unverified'
}

type GetSolanaTokenVerificationInput = {
  /** Mint address. */
  id: string
  /** Ticker already known locally, used when Jupiter has no entry for the mint. */
  ticker?: string
}

/**
 * Verification tier for one mint, for token rows and approval cards. A mint the
 * registry lists is verified without any further lookup, so a token list full
 * of legitimate tokens costs no Jupiter calls. For any other mint the symbol
 * and name are read from Jupiter so a counterfeit is judged by what it actually
 * claims to be, not by the ticker stored locally; falls back to that ticker
 * when the lookup fails, so the label still renders offline.
 */
export const getSolanaTokenVerification = async ({
  id,
  ticker,
}: GetSolanaTokenVerificationInput): Promise<TokenVerification> => {
  const registry = await getSolanaVerifiedTokenRegistry()
  if (registry.byAddress[id]) return 'verified'

  const tokens = await attempt(getJupiterTokens([id]))
  const token = 'data' in tokens ? tokens.data?.[id] : undefined

  return resolveSolanaTokenVerification({
    address: id,
    symbol: token?.symbol ?? ticker,
    name: token?.name,
    isVerified: token?.isVerified,
    registry,
  })
}
