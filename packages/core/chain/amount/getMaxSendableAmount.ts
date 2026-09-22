import { getMaxValue } from '@vultisig/core-chain/amount/getMaxValue'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'

/**
 * Balance a native send has to leave behind so the chain does not reap the
 * sender's account. Substrate refuses a keep-alive transfer that would take
 * the free balance below the existential deposit; chains that let an account
 * empty itself keep nothing back. XRP's reserve is not listed because its
 * balance resolver already reports the spendable remainder.
 */
const retainedBalance: Partial<Record<Chain, bigint>> = {
  [Chain.Bittensor]: bittensorConfig.existentialDeposit,
}

type GetMaxSendableAmountInput = {
  chain: Chain
  balance: bigint
  fee: bigint
  /** Live chain reserve, when supplied; otherwise use the chain's default. */
  reserve?: bigint
}

/**
 * Largest native amount a send can move: the balance less the network fee and
 * whatever the chain requires the sender to keep. Zero when the balance does
 * not cover even those.
 */
export const getMaxSendableAmount = ({ chain, balance, fee, reserve }: GetMaxSendableAmountInput): bigint =>
  getMaxValue(balance, fee + (reserve ?? retainedBalance[chain] ?? 0n))
