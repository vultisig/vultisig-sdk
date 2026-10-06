import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { getEvmBaseFee } from '@vultisig/core-chain/tx/fee/evm/baseFee'
import { getEvmMaxPriorityFeePerGas } from '@vultisig/core-chain/tx/fee/evm/maxPriorityFeePerGas'

import { SwapFees } from '../../swap-types'

/**
 * A fee is only safe to fold into the native-denominated `network`/`total`
 * bigints when it's priced in the source chain's native token. A fee priced
 * in some other asset (e.g. an ERC-20) can't be summed with a wei amount
 * without a unit conversion this SDK doesn't have at fee-extraction time.
 */
const isNativeDenominated = (fee: SwapFee, chain: Chain) =>
  fee.chain === chain && fee.id === undefined && fee.decimals === chainFeeCoin[chain].decimals

const getNativeFeeAmount = (fee: SwapFee | undefined, chain: Chain): bigint =>
  fee && isNativeDenominated(fee, chain) ? fee.amount : 0n

const getProviderFees = (affiliate: bigint, protocol: bigint) => ({
  affiliate: affiliate > 0n ? affiliate : undefined,
  protocol: protocol > 0n ? protocol : undefined,
})

type EvmFeeRates = {
  getBaseFee: (chain: EvmChain) => Promise<bigint>
  getMaxPriorityFeePerGas: (chain: EvmChain) => Promise<bigint>
}

const defaultEvmFeeRates: EvmFeeRates = {
  getBaseFee: getEvmBaseFee,
  getMaxPriorityFeePerGas: getEvmMaxPriorityFeePerGas,
}

/**
 * Extract fees from a swap quote.
 *
 * Native (THORChain/MayaChain) quotes carry an explicit affiliate amount.
 * General-swap quotes (EVM/Solana) carry an optional `affiliateFee`/`swapFee`
 * that previously got silently dropped (EVM) or folded into `total` without
 * ever populating `affiliate` (Solana) — see vultisig-sdk#1450. The
 * provider's own cut rides beside it as `protocolFee` and is reported apart
 * from the affiliate fee, but counted in `total` all the same.
 */
export const extractSwapFees = async (
  quoteData: SwapQuote['quote'],
  fromChain: Chain,
  evmFeeRates: EvmFeeRates = defaultEvmFeeRates
): Promise<SwapFees> => {
  if ('native' in quoteData) {
    return {
      // Native quote fees are destination-denominated, so none belong in this source-native fee summary.
      network: 0n,
      total: 0n,
    }
  }

  // General swaps
  const { tx } = quoteData.general

  // Solana has explicit fees in the quote
  if ('solana' in tx) {
    const networkFee = tx.solana.networkFee
    // SwapFees is native-denominated. Only fold (and surface) a swap fee
    // that's priced in the chain's native token; a non-native swap fee has
    // no native-unit representation here and is left off both fields.
    const nativeSwapFee = getNativeFeeAmount(tx.solana.swapFee, fromChain)
    const nativeProtocolFee = getNativeFeeAmount(tx.solana.protocolFee, fromChain)
    return {
      network: networkFee,
      ...getProviderFees(nativeSwapFee, nativeProtocolFee),
      total: networkFee + nativeSwapFee + nativeProtocolFee,
    }
  }

  // EVM - estimate from gasLimit × gas price
  if ('evm' in tx) {
    const nativeAffiliateFee = getNativeFeeAmount(tx.evm.affiliateFee, fromChain)
    const nativeProtocolFee = getNativeFeeAmount(tx.evm.protocolFee, fromChain)
    let networkFee = 0n
    if (tx.evm.gasLimit && isChainOfKind(fromChain, 'evm')) {
      try {
        const baseFee = await evmFeeRates.getBaseFee(fromChain)
        const priorityFee = await evmFeeRates.getMaxPriorityFeePerGas(fromChain)
        networkFee = tx.evm.gasLimit * (baseFee + priorityFee)
      } catch {
        // Keep the quote's known affiliate fee when network estimation fails.
      }
    }
    return {
      network: networkFee,
      ...getProviderFees(nativeAffiliateFee, nativeProtocolFee),
      total: networkFee + nativeAffiliateFee + nativeProtocolFee,
    }
  }

  // UTXO/Cosmos source via deposit channel: fees come from the source-chain tx,
  // not from the SwapKit quote. Return 0n — real source-chain fees are estimated
  // at broadcast time by TransactionBuilder.estimateSendFee() (which wraps
  // getSendFeeEstimate() from @vultisig/core-mpc). This is the same estimator
  // used for regular UTXO sends. Leave maxSwapable at 0n because a plain-send
  // estimate cannot model the provider-built deposit transaction safely.
  if ('transfer' in tx) {
    return {
      network: 0n,
      total: 0n,
    }
  }

  // Fallback for unknown swap types
  return {
    network: 0n,
    total: 0n,
  }
}
