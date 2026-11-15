import { getMaxValue } from '@vultisig/core-chain/amount/getMaxValue'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'

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

/**
 * Balance a native send keeps back even when it is allowed to empty the
 * account. Solana rejects a send that leaves the sender between zero and the
 * rent-exempt minimum. A MAX that lands on exactly zero would go through, but
 * the priority fee is read again when the signed payload is built. If it
 * comes in lower than the quote, a sub-rent remainder is left and the
 * transaction is rejected.
 */
const rentExemptReserve: Partial<Record<Chain, bigint>> = {
  [Chain.Solana]: BigInt(solanaConfig.walletRentExemptLamports),
}

type GetMaxSendableAmountInput = {
  chain: Chain
  balance: bigint
  fee: bigint
  /**
   * The send is meant to empty the account (a Substrate `transfer_allow_death`),
   * so nothing is kept back for the existential deposit.
   */
  allowDeath?: boolean
}

/**
 * Largest native amount a send can move: the balance less the network fee and
 * whatever the chain requires the sender to keep. Zero when the balance does
 * not cover even those.
 */
export const getMaxSendableAmount = ({ chain, balance, fee, allowDeath = false }: GetMaxSendableAmountInput): bigint =>
  getMaxValue(balance, fee + (allowDeath ? 0n : (retainedBalance[chain] ?? 0n)) + (rentExemptReserve[chain] ?? 0n))
