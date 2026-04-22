import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { SolanaSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import {
  KeysignPayload,
  KeysignPayloadSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'

import { getPreSigningOutput } from '../../../preSigningOutput'
import { getEncodedSigningInputs } from '../../../signingInputs'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'

const rentExemptionAccountSize = 165
const microLamportsPerLamport = 1_000_000n

type RefineSolanaChainSpecificInput = {
  keysignPayload: KeysignPayload
  chainSpecific: SolanaSpecific
  priorityFeePrice: number
  walletCore: WalletCore
}

export const refineSolanaChainSpecific = async ({
  keysignPayload,
  chainSpecific,
  priorityFeePrice,
  walletCore,
}: RefineSolanaChainSpecificInput): Promise<SolanaSpecific> => {
  const coin = getKeysignCoin(keysignPayload)
  const [client, { Message }] = await Promise.all([
    getSolanaClient(),
    import('@solana/web3.js'),
  ])

  const [txInputData] = getEncodedSigningInputs({
    keysignPayload: create(KeysignPayloadSchema, {
      ...keysignPayload,
      blockchainSpecific: {
        case: 'solanaSpecific',
        value: chainSpecific,
      },
    }),
    walletCore,
  })

  const { data } = getPreSigningOutput({
    walletCore,
    txInputData,
    chain: Chain.Solana,
  })

  const message = Message.from(data)

  const getBaseFee = async () => {
    const response = await client.getFeeForMessage(message, 'confirmed')

    return BigInt(response.value ?? 0)
  }

  const getRentExemptionFee = async () => {
    if (!isFeeCoin(coin) && !chainSpecific.toTokenAssociatedAddress) {
      const rentExemption = await client.getMinimumBalanceForRentExemption(
        rentExemptionAccountSize
      )
      return BigInt(rentExemption)
    }

    return 0n
  }

  const baseFee = await getBaseFee()
  const rentExemptionFee = await getRentExemptionFee()

  const priorityFeeAmount =
    (BigInt(priorityFeePrice) * BigInt(solanaConfig.priorityFeeLimit)) /
    microLamportsPerLamport

  const totalFee = baseFee + rentExemptionFee + priorityFeeAmount

  return {
    ...chainSpecific,
    priorityFee: totalFee.toString(),
  }
}
