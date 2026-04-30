import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n

export const getSolanaFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const { priorityFee, computeLimit, toTokenAssociatedAddress } =
    getBlockchainSpecificValue(
      keysignPayload.blockchainSpecific,
      'solanaSpecific'
    )

  const priorityFeeAmount =
    (BigInt(priorityFee) *
      BigInt(computeLimit ?? solanaConfig.priorityFeeLimit)) /
    MICRO_LAMPORTS_PER_LAMPORT

  const coin = getKeysignCoin(keysignPayload)
  const ataRent =
    !isFeeCoin(coin) && !toTokenAssociatedAddress
      ? BigInt(solanaConfig.ataRentLamports)
      : 0n

  return BigInt(solanaConfig.baseFee) + ataRent + priorityFeeAmount
}
