import { createConfig, getQuote } from '@lifi/sdk'
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { lifiConfig } from '@vultisig/core-chain/swap/general/lifi/config'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { memoize } from '@vultisig/lib-utils/memoize'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

import { AccountCoinKey } from '../../../../coin/AccountCoin'
import { GeneralSwapQuote } from '../../GeneralSwapQuote'

export type LifiAffiliateConfig = Pick<typeof lifiConfig, 'integratorName'>

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
  lifiAffiliateConfig?: LifiAffiliateConfig
}

const setupLifi = memoize(() => {
  createConfig({
    integrator: lifiConfig.integratorName,
  })
})

export const getLifiSwapQuote = async ({
  amount,
  affiliateBps,
  lifiAffiliateConfig,
  ...transfer
}: Input): Promise<GeneralSwapQuote> => {
  // lifiAffiliateConfig is only used for the fee attribution in the getQuote call.
  // The createConfig integrator is set once at module init (vultisig-0 default).
  // When Station's integrator name is confirmed, the caller should pass it via
  // lifiAffiliateConfig.integratorName — the getQuote request will tag fees
  // to that integrator even though createConfig uses vultisig-0.
  setupLifi()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  const quote = await getQuote({
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress,
    toAddress,
    fee: affiliateBps ? affiliateBps / 10000 : undefined,
    ...(lifiAffiliateConfig ? { integrator: lifiAffiliateConfig.integratorName } : {}),
  })

  const { transactionRequest, estimate } = quote

  const chainKind = getChainKind(transfer.from.chain)

  const { value, gasLimit, data, from, to } = shouldBePresent(transactionRequest)

  return {
    dstAmount: estimate.toAmount,
    provider: 'li.fi',
    tx: match<DeriveChainKind<LifiSwapEnabledChain>, GeneralSwapQuote['tx']>(chainKind, {
      solana: () => {
        const { gasCosts, feeCosts } = estimate
        const [networkFee] = shouldBePresent(gasCosts)

        const fees = shouldBePresent(feeCosts)

        const swapFee = shouldBePresent(fees.find(fee => fee.name === 'LIFI Fixed Fee') || fees[0])

        const swapFeeAssetId =
          [fromToken, toToken].find(token => token === swapFee.token.address) || chainFeeCoin[transfer.from.chain].id

        return {
          solana: {
            data: shouldBePresent(data),
            networkFee: BigInt(networkFee.amount),
            swapFee: {
              amount: BigInt(swapFee.amount),
              decimals: swapFee.token.decimals,
              chain: mirrorRecord(lifiSwapChainId)[swapFee.token.chainId],
              id: swapFeeAssetId,
            },
          },
        }
      },
      evm: () => {
        return {
          evm: {
            from: shouldBePresent(from),
            to: shouldBePresent(to),
            data: shouldBePresent(data),
            value: BigInt(shouldBePresent(value)).toString(),
            gasLimit: gasLimit ? BigInt(gasLimit) : undefined,
          },
        }
      },
    }),
  }
}
