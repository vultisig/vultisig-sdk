import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n

export const getSolanaFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const { priorityFee, computeLimit, toTokenAssociatedAddress } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'solanaSpecific'
  )

  // The runtime rounds the prioritization fee up to a whole lamport. Rounding
  // down here quotes one lamport short whenever price × limit is not a multiple
  // of a million, and a MAX send quoted that way cannot pay its own fee.
  const priorityFeeMicroLamports = BigInt(priorityFee) * BigInt(computeLimit ?? solanaConfig.priorityFeeLimit)
  const priorityFeeAmount = (priorityFeeMicroLamports + MICRO_LAMPORTS_PER_LAMPORT - 1n) / MICRO_LAMPORTS_PER_LAMPORT

  const coin = getKeysignCoin(keysignPayload)
  const ataRent = !isFeeCoin(coin) && !toTokenAssociatedAddress ? BigInt(solanaConfig.ataRentLamports) : 0n

  return BigInt(solanaConfig.baseFee) + ataRent + priorityFeeAmount
}
