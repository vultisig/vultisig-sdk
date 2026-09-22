import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { assertBoundedInt } from '@vultisig/lib-utils/bigint/assertBoundedInt'
import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getSolanaComputeBudget } from '../../../chainSpecific/resolvers/solana/computeBudget'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'

type GetSolanaSendSigningInputInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

export const getSolanaSendSigningInput = ({
  keysignPayload,
  walletCore,
}: GetSolanaSendSigningInputInput): TW.Solana.Proto.SigningInput => {
  const coin = getKeysignCoin(keysignPayload)

  const {
    recentBlockHash,
    fromTokenAssociatedAddress,
    toTokenAssociatedAddress,
    programId,
    computeLimit,
    priorityFee,
  } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'solanaSpecific')

  const { price, limit } = getSolanaComputeBudget({ priorityFee, computeLimit })

  const amount = assertBoundedInt(parseNonNegativeBigInt(keysignPayload.toAmount).toString(), 'uint64')
  const sender = coin.address
  const recipient = keysignPayload.toAddress

  const getSigningInputCoinSpecificFields = (): Partial<TW.Solana.Proto.SigningInput> => {
    if (!coin.id) {
      return {
        transferTransaction: TW.Solana.Proto.Transfer.create({
          recipient,
          value: Long.fromString(amount, true),
          memo: keysignPayload.memo,
        }),
      }
    }

    const tokenProgramId = programId
      ? TW.Solana.Proto.TokenProgramId.Token2022Program
      : TW.Solana.Proto.TokenProgramId.TokenProgram

    const tokenTransferSharedFields = {
      tokenMintAddress: coin.id,
      senderTokenAddress: fromTokenAssociatedAddress,
      amount: Long.fromString(amount, true),
      decimals: coin.decimals,
      tokenProgramId,
      memo: keysignPayload.memo,
    }

    if (!toTokenAssociatedAddress) {
      const receiverSolanaAddress = walletCore.SolanaAddress.createWithString(recipient)

      const recipientTokenAddress = programId
        ? receiverSolanaAddress.token2022Address(coin.id)
        : receiverSolanaAddress.defaultTokenAddress(coin.id)

      const tokenTransferMessage = TW.Solana.Proto.CreateAndTransferToken.create({
        ...tokenTransferSharedFields,
        recipientMainAddress: recipient,
        recipientTokenAddress,
      })

      return {
        createAndTransferTokenTransaction: tokenTransferMessage,
      }
    }

    return {
      tokenTransferTransaction: TW.Solana.Proto.TokenTransfer.create({
        ...tokenTransferSharedFields,
        recipientTokenAddress: toTokenAssociatedAddress,
      }),
    }
  }

  const signingInput = TW.Solana.Proto.SigningInput.create({
    v0Msg: true,
    recentBlockhash: recentBlockHash,
    sender,
    priorityFeePrice: TW.Solana.Proto.PriorityFeePrice.create({
      price: Long.fromString(price.toString(), true),
    }),
    priorityFeeLimit: TW.Solana.Proto.PriorityFeeLimit.create({
      limit,
    }),
    ...getSigningInputCoinSpecificFields(),
  })

  return signingInput
}
