import { EvmChain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { getEvmChainId } from '@vultisig/core-chain/chains/evm/chainInfo'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { OneInchSwapQuoteResponse } from '@vultisig/core-chain/swap/general/oneInch/api/OneInchSwapQuoteResponse'
import { oneInchAffiliateConfig } from '@vultisig/core-chain/swap/general/oneInch/oneInchAffiliateConfig'
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
  amount: bigint
  affiliateBps?: number
  oneInchConfig?: OneInchAffiliateConfig
  /** Slippage tolerance in percent (e.g. 0.5 = 0.5%). Defaults to 0.5. */
  slippage?: number
}

const getBaseUrl = (chainId: number) => `${rootApiUrl}/1inch/swap/v6.0/${chainId}/swap`

export const getOneInchSwapQuote = async ({
  account,
  fromCoinId,
  toCoinId,
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

  return {
    dstAmount,
    provider: '1inch',
    tx: {
      evm: {
        ...tx,
        gasLimit: tx.gas ? BigInt(tx.gas) : undefined,
      },
    },
  }
}
