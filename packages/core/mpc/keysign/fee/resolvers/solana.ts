import { VersionedTransaction } from '@solana/web3.js'
import { getSolanaMessageFee } from '@vultisig/core-chain/chains/solana/computeBudget'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Buffer } from 'buffer'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { getKeysignSwapPayload } from '../../swap/getKeysignSwapPayload'
import { getKeysignCoin } from '../../utils/getKeysignCoin'
import { FeeAmountResolver } from '../resolver'

const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n

// An aggregator swap is signed as the provider built it, with only the
// blockhash replaced, so the transaction's own ComputeBudget instructions set
// what the network charges, not the priority fee in the chain-specific fields.
const getProviderSwapNetworkFee = (keysignPayload: KeysignPayload): bigint | undefined => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('general' in swapPayload)) return undefined

  const data = swapPayload.general.quote?.tx?.data
  if (!data) return undefined

  return getSolanaMessageFee(VersionedTransaction.deserialize(Buffer.from(data, 'base64')).message)
}

export const getSolanaFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const { priorityFee, computeLimit, toTokenAssociatedAddress } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'solanaSpecific'
  )

  const coin = getKeysignCoin(keysignPayload)
  const ataRent = !isFeeCoin(coin) && !toTokenAssociatedAddress ? BigInt(solanaConfig.ataRentLamports) : 0n

  const providerSwapNetworkFee = getProviderSwapNetworkFee(keysignPayload)
  if (providerSwapNetworkFee !== undefined) {
    return providerSwapNetworkFee + ataRent
  }

  // The runtime rounds the prioritization fee up to a whole lamport. Rounding
  // down here quotes one lamport short whenever price × limit is not a multiple
  // of a million, and a MAX send quoted that way cannot pay its own fee.
  const priorityFeeMicroLamports = BigInt(priorityFee) * BigInt(computeLimit ?? solanaConfig.priorityFeeLimit)
  const priorityFeeAmount = (priorityFeeMicroLamports + MICRO_LAMPORTS_PER_LAMPORT - 1n) / MICRO_LAMPORTS_PER_LAMPORT

  return BigInt(solanaConfig.baseFee) + ataRent + priorityFeeAmount
}
