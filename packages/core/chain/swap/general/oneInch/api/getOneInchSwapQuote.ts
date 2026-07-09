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
  fromCoinId: string
  toCoinId: string
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
    src: isFeeCoin({ id: fromCoinId, chain: account.chain }) ? evmNativeCoinAddress : fromCoinId,
    dst: isFeeCoin({ id: toCoinId, chain: account.chain }) ? evmNativeCoinAddress : toCoinId,
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
