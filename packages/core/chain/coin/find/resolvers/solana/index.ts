import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSplAccounts } from '@vultisig/core-chain/chains/solana/spl/getSplAccounts'
import { resolveSolanaTokenVerification } from '@vultisig/core-chain/chains/solana/spl/verification'
import { getSolanaVerifiedTokenRegistry } from '@vultisig/core-chain/chains/solana/spl/verifiedRegistry'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getSolanaCoingeckoIds } from '@vultisig/core-chain/coin/coingecko/getCoingeckoId'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { getJupiterTokens } from '@vultisig/core-chain/coin/jupiter/api'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { without } from '@vultisig/lib-utils/array/without'

type SplHolding = {
  mint: string
  amount: bigint
  decimals: number
}

const toHolding = (account: Awaited<ReturnType<typeof getSplAccounts>>[number]): SplHolding => {
  const { mint, tokenAmount } = account.account.data.parsed.info

  return { mint: String(mint), amount: BigInt(tokenAmount.amount), decimals: Number(tokenAmount.decimals) }
}

/**
 * Discovers the SPL and Token-2022 holdings at `address` that pass verification.
 *
 * Only `verified` mints are returned. Solana wallets are carpet-bombed with
 * airdropped counterfeits and zero-decimal spam, and auto-adding those to a
 * vault would put a "USDT" balance on the home screen that the user never
 * received. A verified token is returned whether or not a price id is known
 * for it: gating on price hid legitimate unpriced tokens while letting priced
 * scams through. Unverified and scam mints can still be added by hand, where
 * the UI labels them.
 *
 * Jupiter answers for a hundred mints per call and CoinGecko for thirty, so a
 * whole wallet costs a handful of calls; decimals come from the token account
 * itself, and curated metadata wins for tokens we ship ourselves. A failed
 * price-id lookup fails the round, since the caller persists the result and a
 * token saved without its price id would stay unpriced for good.
 */
export const findSolanaCoins: FindCoinsResolver<OtherChain.Solana> = async ({ address, chain }) => {
  const accounts = await getSplAccounts(address)

  const holdings = new Map<string, SplHolding>()
  for (const account of accounts) {
    const holding = toHolding(account)
    if (holding.amount > 0n && !holdings.has(holding.mint)) holdings.set(holding.mint, holding)
  }

  if (holdings.size === 0) return []

  const mints = [...holdings.keys()]
  const [tokens, registry] = await Promise.all([getJupiterTokens(mints), getSolanaVerifiedTokenRegistry()])

  const verified = [...holdings.values()].filter(({ mint }) => {
    const token = tokens[mint]
    const verification = resolveSolanaTokenVerification({
      address: mint,
      symbol: token?.symbol,
      name: token?.name,
      isVerified: token?.isVerified,
      registry,
    })

    return verification === 'verified'
  })

  const getKnown = (mint: string) => knownTokensIndex[chain][mint.toLowerCase()]

  const priceProviderIds = await getSolanaCoingeckoIds(
    verified.filter(({ mint }) => !getKnown(mint)).map(({ mint }) => mint)
  )

  const coins = verified.map(({ mint: id, decimals }): AccountCoin<OtherChain.Solana> | undefined => {
    const known = getKnown(id)
    if (known) {
      return { ...known, chain, id, address }
    }

    const token = tokens[id]
    const listed = registry.byAddress[id]

    const ticker = token?.symbol ?? listed?.symbol
    if (!ticker) return

    const logo = token?.icon ?? listed?.logo
    const priceProviderId = priceProviderIds[id]

    return {
      chain,
      id,
      address,
      ticker,
      decimals,
      ...(logo === undefined ? {} : { logo }),
      ...(priceProviderId === undefined ? {} : { priceProviderId }),
    }
  })

  return without(coins, undefined)
}
