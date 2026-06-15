import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCardanoCurrentSlot } from '@vultisig/core-chain/chains/cardano/client/currentSlot'
import { cardanoDefaultFee } from '@vultisig/core-chain/chains/cardano/config'
import { cardanoSlotOffset } from '@vultisig/core-chain/chains/cardano/config'
import { getPreSigningOutput } from '@vultisig/core-mpc/keysign/preSigningOutput'
import { CardanoChainSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { bigIntSum } from '@vultisig/lib-utils/bigint/bigIntSum'
import { TW, type WalletCore } from '@trustwallet/wallet-core'

import { getCardanoSigningInputs } from '../../signingInputs/resolvers/cardano'
import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { buildCip20AuxData, patchTxBodyWithAuxHash } from '../../../tx/compile/cardano/buildCip20AuxData'
import { getKeysignAmount } from '../../utils/getKeysignAmount'
import { GetChainSpecificResolver } from '../resolver'

// Cardano fee formula: fee = a * txBytes + b (mainnet params)
const CARDANO_A_PARAM = 44n
const CARDANO_B_PARAM = 155_381n
const CARDANO_FEE_ESTIMATION_LIMIT = 5

type EstimateCardanoByteFeeInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  ttl: bigint
  sendMaxAmount: boolean
}

const getCardanoPricedSize = ({ txBodyCbor, memo }: { txBodyCbor: Uint8Array; memo?: string }) => {
  if (!memo) {
    return txBodyCbor.length
  }

  const { auxDataCbor, auxDataHash } = buildCip20AuxData(memo)
  const patchedTxBodyCbor = patchTxBodyWithAuxHash(txBodyCbor, auxDataHash)

  return patchedTxBodyCbor.length + auxDataCbor.length
}

const estimateCardanoByteFee = async ({
  keysignPayload,
  walletCore,
  ttl,
  sendMaxAmount,
}: EstimateCardanoByteFeeInput) => {
  let byteFee = BigInt(cardanoDefaultFee)

  for (let i = 0; i < CARDANO_FEE_ESTIMATION_LIMIT; i++) {
    const [signingInput] = await getCardanoSigningInputs({
      keysignPayload: {
        ...keysignPayload,
        blockchainSpecific: {
          case: 'cardano',
          value: create(CardanoChainSpecificSchema, { ttl, sendMaxAmount, byteFee }),
        },
      },
      walletCore,
    })
    const txInputData = TW.Cardano.Proto.SigningInput.encode(signingInput).finish()
    const preOutput = getPreSigningOutput({ walletCore, txInputData, chain: Chain.Cardano })
    const nextByteFee =
      CARDANO_A_PARAM * BigInt(getCardanoPricedSize({ txBodyCbor: preOutput.data, memo: keysignPayload.memo })) +
      CARDANO_B_PARAM

    if (nextByteFee === byteFee) {
      return byteFee
    }

    byteFee = nextByteFee
  }

  return byteFee
}

export const getCardanoChainSpecific: GetChainSpecificResolver<'cardano'> = async ({ keysignPayload, walletCore }) => {
  const amount = getKeysignAmount(keysignPayload)

  const currentSlot = await getCardanoCurrentSlot()
  const ttl = currentSlot + BigInt(cardanoSlotOffset)

  const utxoInfo = keysignPayload.utxoInfo
  const balance = bigIntSum(utxoInfo.map(({ amount }) => amount))
  const sendMaxAmount = amount ? balance === amount : false

  const byteFee = await estimateCardanoByteFee({ keysignPayload, walletCore, ttl, sendMaxAmount })

  return create(CardanoChainSpecificSchema, {
    ttl,
    sendMaxAmount,
    byteFee,
  })
}
