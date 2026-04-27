// RN override for
// `@vultisig/core-mpc/keysign/chainSpecific/resolvers/solana/refine`.
//
// The core refiner statically imports `Message` from `@solana/web3.js`.
// Same Hermes hazard as the other Solana overrides — evaluating the
// module triggers `rpc-websockets` / `ws` module-init. We defer the
// import to inside the async body so RN apps that never call into a
// Solana keysign flow don't pay the cost.
//
// Public surface mirrors core exactly: a single
// `refineSolanaChainSpecific(input): Promise<SolanaSpecific>` export.
import { create } from '@bufbuild/protobuf'
import { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { getPreSigningOutput } from '@vultisig/core-mpc/keysign/preSigningOutput'
import { getEncodedSigningInputs } from '@vultisig/core-mpc/keysign/signingInputs'
import { getKeysignCoin } from '@vultisig/core-mpc/keysign/utils/getKeysignCoin'
import { SolanaSpecific } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

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
  const client = getSolanaClient()
  const { Message } = await import('@solana/web3.js')

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
      const rentExemption = await client.getMinimumBalanceForRentExemption(rentExemptionAccountSize)
      return BigInt(rentExemption)
    }

    return 0n
  }

  const baseFee = await getBaseFee()
  const rentExemptionFee = await getRentExemptionFee()

  const priorityFeeAmount = (BigInt(priorityFeePrice) * BigInt(solanaConfig.priorityFeeLimit)) / microLamportsPerLamport

  const totalFee = baseFee + rentExemptionFee + priorityFeeAmount

  return {
    ...chainSpecific,
    priorityFee: totalFee.toString(),
  }
}
