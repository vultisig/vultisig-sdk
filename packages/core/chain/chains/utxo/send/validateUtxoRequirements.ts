import { UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { formatAmount } from '@vultisig/lib-utils/formatAmount'

import { fromChainAmount } from '../../../amount/fromChainAmount'
import { minUtxo } from '../minUtxo'

type Input = {
  amount: bigint
  balance: bigint
  chain: UtxoBasedChain
  /**
   * When set (native fee coin), change after send is `balance - amount - fee`.
   * Omit when the fee is paid from a different balance.
   */
  fee?: bigint
  /**
   * Skip dust/change validation when the fee is not yet known (avoids false positives).
   */
  skipDustCheck?: boolean
}

export type UtxoMinSendAmountInput = Pick<Input, 'amount' | 'chain'>

export const getUtxoMinSendAmountError = ({ amount, chain }: UtxoMinSendAmountInput): string | undefined => {
  if (amount >= minUtxo[chain]) {
    return
  }

  const { decimals, ticker } = chainFeeCoin[chain]
  const formattedAmount = formatAmount(fromChainAmount(minUtxo[chain], decimals), { ticker })
  return `Minimum send amount is ${formattedAmount}. ${chain} requires this to prevent spam.`
}

export const validateUtxoRequirements = ({ amount, balance, chain, fee, skipDustCheck }: Input): string | undefined => {
  const minSendAmountError = getUtxoMinSendAmountError({ amount, chain })
  if (minSendAmountError) {
    return minSendAmountError
  }

  if (skipDustCheck) {
    return
  }

  const remainingBalance = fee != null ? balance - amount - fee : balance - amount

  if (remainingBalance === 0n) {
    return
  }

  if (remainingBalance < minUtxo[chain]) {
    return `This amount would leave too little change. 💡 Try 'Max' to avoid this issue.`
  }
}
