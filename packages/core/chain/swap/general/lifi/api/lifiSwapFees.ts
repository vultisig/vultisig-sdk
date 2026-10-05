import type { FeeCost, Token } from '@lifi/sdk'
import { evmNativeCoinAddress } from '@vultisig/core-chain/chains/evm/config'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { resolveSwapFeeChain } from './lifiSwapFeeChain'

const zeroAddress = '0x0000000000000000000000000000000000000000'

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
 * integrator's either. An entry in another token cannot be added and is
 * skipped.
 */
const sumLifiFeeShares = (feeCosts: FeeCost[]): LifiFeeShares | undefined => {
  const splitFees = feeCosts.filter((fee): fee is SplitFeeCost => Boolean(fee.feeSplit))
  const [first] = splitFees
  if (!first) {
    return undefined
  }

  return splitFees.reduce<LifiFeeShares>(
    (shares, { name, token, amount, feeSplit }) => {
      if (!isSameLifiToken(token, shares.token)) {
        console.warn(
          `[getLifiSwapQuote] fee "${name}" is in ${token.symbol}, not ${shares.token.symbol}; leaving it out`
        )
        return shares
      }

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
 * swap fee.
 */
export const getLifiSolanaSwapFees = ({
  feeCosts,
  fromChain,
  routeTokens,
}: GetLifiSolanaSwapFeesInput): LifiSolanaSwapFees => {
  const { token, integratorAmount, protocolAmount } = sumLifiFeeShares(feeCosts) ?? toUndividedLifiFeeShares(feeCosts)

  const coin = {
    decimals: token.decimals,
    chain: resolveSwapFeeChain(token.chainId, fromChain),
    id: routeTokens.find(routeToken => routeToken === token.address) || chainFeeCoin[fromChain].id,
  }

  return {
    swapFee: { ...coin, amount: integratorAmount },
    ...(protocolAmount > 0n ? { protocolFee: { ...coin, amount: protocolAmount } } : {}),
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
 */
export const getLifiEvmSwapFees = ({ feeCosts, fromChain }: GetLifiEvmSwapFeesInput): LifiEvmSwapFees => {
  const shares = sumLifiFeeShares(feeCosts)
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
