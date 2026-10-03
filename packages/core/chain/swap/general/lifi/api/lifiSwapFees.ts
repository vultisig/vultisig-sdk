import type { FeeCost } from '@lifi/sdk'
import { evmNativeCoinAddress } from '@vultisig/core-chain/chains/evm/config'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { resolveSwapFeeChain } from './lifiSwapFeeChain'

const zeroAddress = '0x0000000000000000000000000000000000000000'

type LifiFixedFeeSplit = {
  fee: FeeCost
  integratorAmount: bigint
  protocolAmount: bigint
}

/**
 * LI.FI charges its own cut and the integrator's in a single `feeCosts` entry:
 * `amount` is the whole charge and `feeSplit.integratorFee` the integrator's
 * slice alone. On a 0.01 SOL swap at 30 bps that entry is 55000 lamports, of
 * which 30000 go to the integrator and 25000 to LI.FI (vultisig-sdk#2396).
 *
 * The protocol slice is taken as the remainder rather than read from
 * `feeSplit.lifiFee`, so the two slices always add up to what the entry
 * charges — an intermediary's slice, when present, is not ours either.
 */
const splitLifiFixedFee = (feeCosts: FeeCost[]): LifiFixedFeeSplit | undefined => {
  const fee = feeCosts.find(({ feeSplit }) => feeSplit)
  if (!fee?.feeSplit) {
    return undefined
  }

  const amount = BigInt(fee.amount)
  const integratorFee = BigInt(fee.feeSplit.integratorFee)
  const integratorAmount = integratorFee < amount ? integratorFee : amount

  return { fee, integratorAmount, protocolAmount: amount - integratorAmount }
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
 * Splits a Solana LI.FI quote's fixed fee into the integrator's cut and
 * LI.FI's own. A fee entry without a `feeSplit` cannot be divided, so it is
 * reported whole as the swap fee, as it was before the split existed.
 */
export const getLifiSolanaSwapFees = ({
  feeCosts,
  fromChain,
  routeTokens,
}: GetLifiSolanaSwapFeesInput): LifiSolanaSwapFees => {
  const split = splitLifiFixedFee(feeCosts)
  const fee = split?.fee ?? shouldBePresent(feeCosts.find(({ name }) => name === 'LIFI Fixed Fee') || feeCosts[0])

  const coin = {
    decimals: fee.token.decimals,
    chain: resolveSwapFeeChain(fee.token.chainId, fromChain),
    id: routeTokens.find(token => token === fee.token.address) || chainFeeCoin[fromChain].id,
  }

  if (!split) {
    return { swapFee: { ...coin, amount: BigInt(fee.amount) } }
  }

  return {
    swapFee: { ...coin, amount: split.integratorAmount },
    ...(split.protocolAmount > 0n ? { protocolFee: { ...coin, amount: split.protocolAmount } } : {}),
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
 * Splits an EVM LI.FI quote's fixed fee into the integrator's cut and LI.FI's
 * own, omitting either one that is zero. A fee entry without a `feeSplit` is
 * left out entirely: its amount can include more than the integrator's share,
 * so it cannot be attributed to anyone.
 */
export const getLifiEvmSwapFees = ({ feeCosts, fromChain }: GetLifiEvmSwapFeesInput): LifiEvmSwapFees => {
  const split = splitLifiFixedFee(feeCosts)
  if (!split) {
    return {}
  }

  const { token } = split.fee
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
    ...(split.integratorAmount > 0n ? { affiliateFee: { ...coin, amount: split.integratorAmount } } : {}),
    ...(split.protocolAmount > 0n ? { protocolFee: { ...coin, amount: split.protocolAmount } } : {}),
  }
}
