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

type Input = Record<TransferDirection, AccountCoinKey<LifiSwapEnabledChain>> & {
  amount: bigint
  affiliateBps?: number
}

const setupLifi = memoize(() => {
  createConfig({
    integrator: lifiConfig.integratorName,
  })
})

export const getLifiSwapQuote = async ({ amount, affiliateBps, ...transfer }: Input): Promise<GeneralSwapQuote> => {
  setupLifi()

  const [fromChain, toChain] = [transfer.from, transfer.to].map(({ chain }) => lifiSwapChainId[chain])

  const [fromToken, toToken] = [transfer.from, transfer.to].map(({ id, chain }) => id ?? chainFeeCoin[chain].ticker)
  const [fromAddress, toAddress] = [transfer.from, transfer.to].map(({ address }) => address)

  // Slippage tolerance baked into the LiFi-prebuilt swap tx. The
  // returned `transactionRequest.data` is a fully-formed Solana / EVM
  // transaction that encodes a minAmountOut floor at quote time —
  // the underlying AMM (Raydium / Orca / Meteora on Solana; Uniswap /
  // 1inch on EVM) reverts if simulation-time output drops below the
  // floor. Default LiFi slippage is 0.005 (0.5%), which is far too
  // tight for MPC-signed flows where the keysign ceremony adds
  // 30-90s of clock drift between quote and broadcast and the price
  // routinely moves more than 0.5% on volatile pairs (SOL/USDC,
  // SOL/anything memecoin). Production repro (2026-05-22):
  // SOL→USDC simulation failed with `-32002: custom program error:
  // 0x32` (Raydium AMM error 50 = AmountExceedsMaximum / slippage
  // exceeded). Bump to 1% — covers the typical ceremony drift while
  // staying well inside the user's pre-sign card's risk surface
  // (typical realised slippage on these aggregators is <0.1%, so
  // the 1% is a ceiling, not the expected price hit).
  //
  // EVM is less time-sensitive (no MPC ceremony delay equivalent —
  // the model dispatches and the user signs in seconds) but the
  // same 1% bump still helps when the user pauses on the pre-sign
  // card for a moment.
  const SLIPPAGE_TOLERANCE = 0.01

  const quote = await getQuote({
    fromChain,
    toChain,
    fromToken,
    toToken,
    fromAmount: amount.toString(),
    fromAddress,
    toAddress,
    fee: affiliateBps ? affiliateBps / 10000 : undefined,
    slippage: SLIPPAGE_TOLERANCE,
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
