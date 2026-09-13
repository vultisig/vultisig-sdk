import { Chain, EvmChain } from '@vultisig/core-chain/Chain'
import { SwapFee } from '@vultisig/core-chain/swap/SwapFee'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getEvmBaseFee } from '@vultisig/core-chain/tx/fee/evm/baseFee'
import { getEvmMaxPriorityFeePerGas } from '@vultisig/core-chain/tx/fee/evm/maxPriorityFeePerGas'

import { SwapFees } from '../../swap-types'

/**
 * A fee is only safe to fold into the native-denominated `network`/`total`
 * bigints when it's priced in the source chain's native token. A fee priced
 * in some other asset (e.g. an ERC-20) can't be summed with a wei amount
 * without a unit conversion this SDK doesn't have at fee-extraction time.
 */
const isNativeDenominated = (fee: SwapFee, chain: Chain) => fee.chain === chain && fee.id === undefined

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
 * ever populating `affiliate` (Solana) — see vultisig-sdk#1450.
 */
export const extractSwapFees = async (
  quoteData: SwapQuote['quote'],
  fromChain: Chain,
  evmFeeRates: EvmFeeRates = defaultEvmFeeRates
): Promise<SwapFees> => {
  if ('native' in quoteData) {
    return {
      network: BigInt(quoteData.native.fees.outbound),
      affiliate: quoteData.native.fees.affiliate ? BigInt(quoteData.native.fees.affiliate) : undefined,
      total: BigInt(quoteData.native.fees.total),
    }
  }

  // General swaps
  const { tx } = quoteData.general

  // Solana has explicit fees in the quote
  if ('solana' in tx) {
    const networkFee = tx.solana.networkFee
    const swapFee = tx.solana.swapFee
    // SwapFees is native-denominated. Only fold (and surface) a swap fee
    // that's priced in the chain's native token; a non-native swap fee has
    // no native-unit representation here and is left off both fields.
    const nativeSwapFee = isNativeDenominated(swapFee, fromChain) ? swapFee.amount : 0n
    return {
      network: networkFee,
      affiliate: nativeSwapFee > 0n ? nativeSwapFee : undefined,
      total: networkFee + nativeSwapFee,
    }
  }

  // EVM - estimate from gasLimit × gas price
  if ('evm' in tx && tx.evm.gasLimit) {
    try {
      const evmChain = fromChain as EvmChain
      const baseFee = await evmFeeRates.getBaseFee(evmChain)
      const priorityFee = await evmFeeRates.getMaxPriorityFeePerGas(evmChain)
      const networkFee = tx.evm.gasLimit * (baseFee + priorityFee)
      const affiliateFee = tx.evm.affiliateFee
      const nativeAffiliateFee =
        affiliateFee && isNativeDenominated(affiliateFee, fromChain) ? affiliateFee.amount : 0n
      return {
        network: networkFee,
        affiliate: nativeAffiliateFee > 0n ? nativeAffiliateFee : undefined,
        total: networkFee + nativeAffiliateFee,
      }
    } catch {
      // Fall through to default if gas price fetch fails
    }
  }

  // UTXO/Cosmos source via deposit channel: fees come from the source-chain tx,
  // not from the SwapKit quote. Return 0n — real source-chain fees are estimated
  // at broadcast time by TransactionBuilder.estimateSendFee() (which wraps
  // getSendFeeEstimate() from @vultisig/core-mpc). This is the same estimator
  // used for regular UTXO sends. VaultBase.getSwapQuote detects this 0n and
  // keeps maxSwapable=0n rather than overstating it as the full balance.
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
