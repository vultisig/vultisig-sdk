import { EvmChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { assertKnownAggregatorRouter } from '@vultisig/core-chain/swap/general/knownAggregatorRouters'
import { OneInchSwapQuoteResponse } from '@vultisig/core-chain/swap/general/oneInch/api/OneInchSwapQuoteResponse'
import { oneInchAffiliateConfig } from '@vultisig/core-chain/swap/general/oneInch/oneInchAffiliateConfig'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { rootApiUrl } from '@vultisig/core-config'
import { hexToNumber } from '@vultisig/lib-utils/hex/hexToNumber'
import { addQueryParams } from '@vultisig/lib-utils/query/addQueryParams'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { evmNativeCoinAddress } from '../../../../chains/evm/config'

export type OneInchAffiliateConfig = typeof oneInchAffiliateConfig

type Input = {
  account: ChainAccount
  /** The coin's `.id` (contract address), or `undefined` for the chain's native/fee coin.
   * Must NOT be substituted with a ticker fallback by the caller — `isFeeCoin` below relies
   * on `undefined` to detect the native asset and map it to 1inch's `0xEeee...` sentinel. */
  fromCoinId: string | undefined
  toCoinId: string | undefined
  /** Destination coin metadata. When set alongside affiliateBps, populates a display-only
   * affiliateFee (AGG-05) matching the Kyber/LiFi convention. */
  to?: AccountCoin<EvmChain>
  amount: bigint
  affiliateBps?: number
  oneInchConfig?: OneInchAffiliateConfig
  /** Slippage tolerance in percent (e.g. 0.5 = 0.5%). Defaults to 0.5. */
  slippage?: number
}

const getBaseUrl = (chainId: number) => `${rootApiUrl}/1inch/swap/v6.0/${chainId}/swap`

// 1inch's classic swap API requires the chain's native asset to be represented by its
// `0xEeee...` sentinel address (EIP-7528), not a ticker string or the zero address. A coin
// with no `.id` (contract address) is the native/fee coin — undefined is the correct signal
// here, not a ticker fallback, which would be a truthy string and defeat this check.
const resolveOneInchCoinAddress = (coinId: string | undefined, chain: EvmChain): string =>
  isFeeCoin({ id: coinId, chain }) ? evmNativeCoinAddress : (coinId as string)

// 1inch's `fee` param deducts the affiliate cut from dstAmount before returning it — same
// convention as Kyber's /route/build. Gross the net amount back up to derive the fee for
// display, mirroring getKyberSwapAffiliateFee (kyber/api/tx.ts).
const getOneInchAffiliateFee = ({
  dstAmount,
  to,
  affiliateBps,
}: {
  dstAmount: string
  to?: AccountCoin<EvmChain>
  affiliateBps?: number
}): SwapFee | undefined => {
  if (!affiliateBps || !to) {
    return undefined
  }

  const netAmountOut = BigInt(dstAmount)
  const feeRate = BigInt(affiliateBps)
  const grossAmountOut = (netAmountOut * 10000n) / (10000n - feeRate)

  return {
    chain: to.chain,
    id: to.id,
    decimals: to.decimals,
    amount: grossAmountOut - netAmountOut,
  }
}

export const getOneInchSwapQuote = async ({
  account,
  fromCoinId,
  toCoinId,
  to,
  amount,
  affiliateBps,
  oneInchConfig = oneInchAffiliateConfig,
  slippage = 0.5,
}: Input): Promise<GeneralSwapQuote> => {
  const chain = account.chain as EvmChain
  const chainId = hexToNumber(getEvmChainId(chain))

  const params = {
    src: resolveOneInchCoinAddress(fromCoinId, chain),
    dst: resolveOneInchCoinAddress(toCoinId, chain),
    amount: amount.toString(),
    from: account.address,
    slippage,
    disableEstimate: true,
    includeGas: true,
    ...(affiliateBps
      ? {
          referrer: oneInchConfig.referrer,
          fee: affiliateBps / 100,
        }
      : {}),
  }

  const url = addQueryParams(getBaseUrl(chainId), params)

  const { dstAmount, tx }: OneInchSwapQuoteResponse = await queryUrl<OneInchSwapQuoteResponse>(url)

  // AGG-02 fund-safety fix: verify tx.to is 1inch's actual router before this untrusted
  // response can become a signable GeneralSwapQuote. Chain-scoped: 1inch's router differs
  // on zkSync Era. See knownAggregatorRouters.ts.
  assertKnownAggregatorRouter('1inch', tx.to, chain)

  // Fund-safety: 1inch's `tx.value` flows through from the untrusted response VERBATIM (spread
  // below), unlike Kyber which constructs `value` itself. For a TOKEN-source swap the sell token is
  // pulled via ERC-20 allowance (approve/transferFrom), so `value` MUST be 0 — a non-zero value
  // would move native chain gas-coin the user never authorized alongside the swap. A native-source
  // swap (no `fromCoinId`) legitimately carries `value` == the sell amount, so only guard tokens.
  if (!isFeeCoin({ id: fromCoinId, chain }) && tx.value && tx.value !== '0') {
    throw new Error(
      `1inch quote returned a non-zero tx.value (${tx.value}) for a token-source swap on ${chain} — a token swap pulls the sell token via allowance and must not move native value; refusing to sign.`
    )
  }

  return {
    dstAmount,
    provider: '1inch',
    tx: {
      evm: {
        ...tx,
        gasLimit: tx.gas ? BigInt(tx.gas) : undefined,
        affiliateFee: getOneInchAffiliateFee({ dstAmount, to, affiliateBps }),
      },
    },
  }
}
