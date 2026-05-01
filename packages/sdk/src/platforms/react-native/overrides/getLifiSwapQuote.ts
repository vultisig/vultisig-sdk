// RN override for `@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote`.
//
// `@lifi/sdk`'s barrel statically evaluates `@wallet-standard/app`, which
// declares `class AppReadyEvent extends Event` at module top-level. Hermes
// ships without the `Event` / `EventTarget` DOM globals; even with the
// `event-target-polyfill` installed in the RN entry, it only takes effect
// *after* the entry's polyfill import runs. Since `@lifi/sdk` is an
// external module in the RN bundle, metro would resolve it and evaluate
// its module body *before* the bundle body — racing against the polyfill.
//
// This override reaches `@lifi/sdk` via `await import()` inside the async
// body so the module never evaluates unless a swap quote is actually
// requested, by which point the polyfills are fully in place.
//
// Public surface mirrors core byte-for-byte: one `getLifiSwapQuote(input)`
// export returning `Promise<GeneralSwapQuote>`.
import { DeriveChainKind, getChainKind } from '@vultisig/core-chain/ChainKind'
import { AccountCoinKey } from '@vultisig/core-chain/coin/AccountCoin'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { lifiConfig } from '@vultisig/core-chain/swap/general/lifi/config'
import { lifiSwapChainId, LifiSwapEnabledChain } from '@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { match } from '@vultisig/lib-utils/match'
import { memoize } from '@vultisig/lib-utils/memoize'
import { mirrorRecord } from '@vultisig/lib-utils/record/mirrorRecord'
import { TransferDirection } from '@vultisig/lib-utils/TransferDirection'

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
}

const setupLifi = memoize(async () => {
  const { createConfig } = await import('@lifi/sdk')
  createConfig({
    integrator: lifiConfig.integratorName,
  })
})

export const getLifiSwapQuote = async ({ amount, affiliateBps, ...transfer }: Input): Promise<GeneralSwapQuote> => {
  await setupLifi()

  const { getQuote } = await import('@lifi/sdk')

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
