import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'
import { convertDuration } from '@vultisig/lib-utils/time/convertDuration'

import { evmNativeCoinAddress } from '../../../../chains/evm/config'
import { AccountCoin } from '../../../../coin/AccountCoin'
import { isFeeCoin } from '../../../../coin/utils/isFeeCoin'
import { SwapFee } from '../../../SwapFee'
import { GeneralSwapQuote } from '../../GeneralSwapQuote'
import { KyberSwapEnabledChain } from '../chains'
import {
  getKyberSwapAffiliateParams,
  hasAffiliateBps,
  kyberSwapAffiliateConfig,
  kyberSwapSlippageTolerance,
  kyberSwapTxLifespan,
} from '../config'
import { getKyberSwapBaseUrl } from './baseUrl'

type GetKyberSwapTxInput = Record<
  TransferDirection,
  AccountCoin<KyberSwapEnabledChain>
> & {
  routeSummary: any
  routerAddress: string
  amount: bigint
  enableGasEstimation: boolean
  affiliateBps?: number
}

type KyberSwapBuildResponse = {
  code: number
  data: {
    amountOut: string
    data: string
    gas: string
    routerAddress: string
    gasPrice?: string
  }
}

const getKyberSwapAffiliateFee = ({
  amountOut,
  to,
  affiliateBps,
}: {
  amountOut: string
  to: AccountCoin<KyberSwapEnabledChain>
  affiliateBps?: number
}): SwapFee | undefined => {
  if (!hasAffiliateBps(affiliateBps)) {
    return undefined
  }

  const netAmountOut = BigInt(amountOut)
  const feeRate = BigInt(affiliateBps)
  const grossAmountOut = (netAmountOut * 10000n) / (10000n - feeRate)

  return {
    chain: to.chain,
    id: to.id ?? evmNativeCoinAddress,
    decimals: to.decimals,
    amount: grossAmountOut - netAmountOut,
  }
}

export const getKyberSwapTx = async ({
  from,
  to,
  routeSummary,
  routerAddress,
  amount,
  enableGasEstimation,
  affiliateBps,
}: GetKyberSwapTxInput): Promise<GeneralSwapQuote> => {
  const buildPayload = {
    routeSummary,
    sender: from.address,
    recipient: from.address,
    slippageTolerance: kyberSwapSlippageTolerance,
    deadline: Math.round(
      convertDuration(
        Date.now() + convertDuration(kyberSwapTxLifespan, 'min', 'ms'),
        'ms',
        's'
      )
    ),
    enableGasEstimation,
    ...getKyberSwapAffiliateParams(affiliateBps),
    ignoreCappedSlippage: false,
  }

  const buildResponse = await queryUrl<KyberSwapBuildResponse>(
    `${getKyberSwapBaseUrl(from.chain)}/route/build`,
    {
      headers: {
        'X-Client-Id': kyberSwapAffiliateConfig.source,
      },
      body: buildPayload,
    }
  )

  if (buildResponse.code !== 0 || !buildResponse.data) {
    if ('message' in buildResponse) {
      const { message } = buildResponse

      if (isInError(message, 'execution reverted')) {
        throw new Error(`Transaction will revert: ${message}`)
      }

      if (isInError(message, 'insufficient allowance')) {
        throw new Error(`Insufficient allowance: ${message}`)
      }

      if (isInError(message, 'insufficient funds')) {
        throw new Error(`Insufficient funds: ${message}`)
      }

      throw new Error(extractErrorMsg(message))
    }

    throw new Error('Failed to build transaction')
  }

  const { amountOut, data, gas } = buildResponse.data
  return {
    dstAmount: amountOut,
    provider: 'kyber',
    tx: {
      evm: {
        from: from.address,
        to: routerAddress,
        data,
        value: isFeeCoin(from) ? amount.toString() : '0',
        gasLimit: gas ? BigInt(gas) : undefined,
        affiliateFee: getKyberSwapAffiliateFee({
          amountOut,
          to,
          affiliateBps,
        }),
      },
    },
  }
}
