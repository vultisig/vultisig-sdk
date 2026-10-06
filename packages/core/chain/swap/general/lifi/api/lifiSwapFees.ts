import type { FeeCost, Token } from '@lifi/sdk'
import { evmNativeCoinAddress } from '@vultisig/core-chain/chains/evm/config'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { resolveSwapFeeChain } from './lifiSwapFeeChain'

const zeroAddress = '0x0000000000000000000000000000000000000000'

/**
 * LI.FI's native SOL token, and wrapped SOL, which prices as SOL and which the
 * Jupiter quote already treats as the native coin.
 */
const solanaNativeFeeTokenAddresses = new Set([
  '11111111111111111111111111111111',
  'So11111111111111111111111111111111111111112',
])

/** LI.FI split its fees in a shape that one fee per slot cannot carry. */
class LifiFeeShapeError extends Error {}

type LifiFeeShares = {
  token: Token
  integratorAmount: bigint
  protocolAmount: bigint
}

type SplitFeeCost = FeeCost & Required<Pick<FeeCost, 'feeSplit'>>

const isSameLifiToken = (one: Token, another: Token) =>
  one.chainId === another.chainId && one.address.toLowerCase() === another.address.toLowerCase()

/**
 * LI.FI itemizes each fee it collects for a recipient as a `feeCosts` entry
 * carrying a `feeSplit`. Its fixed fee holds LI.FI's cut and the integrator's
 * in one `amount`, with `feeSplit.integratorFee` the integrator's slice alone:
 * on a 0.01 SOL swap at 30 bps that entry is 55000 lamports, 30000 to the
 * integrator and 25000 to LI.FI (vultisig-sdk#2396). Each recipient added
 * through `distributionFees` arrives as a further entry ("Distributions")
 * with no integrator slice. Entries without a split are the route's own
 * costs, such as bridge and liquidity fees, and stay out of this.
 *
 * Every split entry is summed. Each one's protocol slice is the remainder of
 * its `amount` rather than `feeSplit.lifiFee`, so the slices always add up to
 * what the entries charge — intermediary and distribution slices are not the
 * integrator's either.
 *
 * Entries in more than one token throw a [LifiFeeShapeError]: one fee per
 * slot cannot carry several tokens, and adding only the entries that match
 * would report less than the user pays. LI.FI documents its fee amounts in the
 * source token, so no such quote is expected.
 */
const sumLifiFeeShares = (feeCosts: FeeCost[]): LifiFeeShares | undefined => {
  const splitFees = feeCosts.filter((fee): fee is SplitFeeCost => Boolean(fee.feeSplit))
  const [first] = splitFees
  if (!first) {
    return undefined
  }

  if (!splitFees.every(({ token }) => isSameLifiToken(token, first.token))) {
    throw new LifiFeeShapeError('LI.FI split its fees across more than one token.')
  }

  return splitFees.reduce<LifiFeeShares>(
    (shares, { amount, feeSplit }) => {
      const total = BigInt(amount)
      const integratorFee = BigInt(feeSplit.integratorFee)
      const integratorAmount = integratorFee < total ? integratorFee : total

      return {
        token: shares.token,
        integratorAmount: shares.integratorAmount + integratorAmount,
        protocolAmount: shares.protocolAmount + total - integratorAmount,
      }
    },
    { token: first.token, integratorAmount: 0n, protocolAmount: 0n }
  )
}

/**
 * A fixed fee without a split cannot be divided, so it is reported whole as
 * the integrator's, as it was before the split existed.
 */
const toUndividedLifiFeeShares = (feeCosts: FeeCost[]): LifiFeeShares => {
  const { token, amount } = shouldBePresent(feeCosts.find(({ name }) => name === 'LIFI Fixed Fee') || feeCosts[0])

  return { token, integratorAmount: BigInt(amount), protocolAmount: 0n }
}

type GetLifiSolanaSwapFeesInput = {
  feeCosts: FeeCost[]
  fromChain: LifiSwapEnabledChain
  /** The route's two token identifiers, exactly as they were sent to LI.FI. */
  routeTokens: string[]
}

type LifiSolanaSwapFees = {
  swapFee: SwapFee
  protocolFee?: SwapFee
}

/**
 * Splits a Solana LI.FI quote's fees into the integrator's cut and everyone
 * else's — LI.FI's and any distribution recipient's. A quote whose fees carry
 * no `feeSplit` cannot be divided, so its fixed fee is reported whole as the
 * swap fee. One whose fees span several tokens throws: this tx shape requires
 * a swap fee, so the quote is dropped rather than reported short.
 */
export const getLifiSolanaSwapFees = ({
  feeCosts,
  fromChain,
  routeTokens,
}: GetLifiSolanaSwapFeesInput): LifiSolanaSwapFees => {
  const { token, integratorAmount, protocolAmount } = sumLifiFeeShares(feeCosts) ?? toUndividedLifiFeeShares(feeCosts)

  // Keep the fee token's identity when it is neither route token; only LI.FI's
  // native SOL tokens become the native coin.
  const isNativeFee = token.chainId === lifiSwapChainId[fromChain] && solanaNativeFeeTokenAddresses.has(token.address)
  const coin = {
    decimals: token.decimals,
    chain: resolveSwapFeeChain(token.chainId, fromChain),
    id:
      routeTokens.find(routeToken => routeToken === token.address) ??
      (isNativeFee ? chainFeeCoin[fromChain].id : token.address),
  }

  return {
    swapFee: { ...coin, amount: integratorAmount },
    ...(protocolAmount > 0n ? { protocolFee: { ...coin, amount: protocolAmount } } : {}),
  }
}

/**
 * [sumLifiFeeShares] for a route whose fees are display-only: a fee shape it
 * cannot itemize yields none. Anything other than a [LifiFeeShapeError] is a
 * bug and stays loud.
 */
const getDisplayLifiFeeShares = (feeCosts: FeeCost[]): LifiFeeShares | undefined => {
  try {
    return sumLifiFeeShares(feeCosts)
  } catch (error) {
    if (!(error instanceof LifiFeeShapeError)) {
      throw error
    }

    console.warn('[getLifiSwapQuote] unresolved LI.FI fee shape on an EVM route; reporting none', error)
    return undefined
  }
}

type GetLifiEvmSwapFeesInput = {
  feeCosts: FeeCost[]
  fromChain: LifiSwapEnabledChain
}

type LifiEvmSwapFees = {
  affiliateFee?: SwapFee
  protocolFee?: SwapFee
}

/**
 * Splits an EVM LI.FI quote's fees into the integrator's cut and everyone
 * else's — LI.FI's and any distribution recipient's — omitting either one that
 * is zero. A fee entry without a `feeSplit` is left out entirely: its amount
 * can include more than the integrator's share, so it cannot be attributed to
 * anyone.
 *
 * The fees are not part of the signed calldata, so fees that span several
 * tokens are reported as none rather than taking down a route that would
 * otherwise sign — the same terms SwapKit's EVM fees are reported on.
 */
export const getLifiEvmSwapFees = ({ feeCosts, fromChain }: GetLifiEvmSwapFeesInput): LifiEvmSwapFees => {
  const shares = getDisplayLifiFeeShares(feeCosts)
  if (!shares) {
    return {}
  }

  const { token, integratorAmount, protocolAmount } = shares
  const chain = resolveSwapFeeChain(token.chainId, fromChain)
  // Keep LI.FI's fee-token identity even when it differs from both route
  // endpoints. Only its native-token sentinels may become a native fee.
  const normalizedAddress = token.address.toLowerCase()
  const isNativeFee =
    token.chainId === lifiSwapChainId[fromChain] &&
    (normalizedAddress === evmNativeCoinAddress ||
      normalizedAddress === zeroAddress ||
      normalizedAddress === chainFeeCoin[chain].ticker.toLowerCase())

  const coin = {
    decimals: token.decimals,
    chain,
    id: isNativeFee ? undefined : token.address,
  }

  return {
    ...(integratorAmount > 0n ? { affiliateFee: { ...coin, amount: integratorAmount } } : {}),
    ...(protocolAmount > 0n ? { protocolFee: { ...coin, amount: protocolAmount } } : {}),
  }
}
