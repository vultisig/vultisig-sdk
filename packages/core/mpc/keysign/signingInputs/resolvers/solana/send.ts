import { solanaConfig } from '@vultisig/core-chain/chains/solana/solanaConfig'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { toBoundedLong } from '@vultisig/lib-utils/bigint/toBoundedLong'
import { maxBigInt } from '@vultisig/lib-utils/math/maxBigInt'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
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

  // Floor at the config minimum so co-signers all encode the same
  // `setComputeUnitPrice` instruction when the wire value is missing.
  const priorityFeePrice = maxBigInt(priorityFee ? BigInt(priorityFee) : 0n, BigInt(solanaConfig.priorityFeePrice))

  // Lamports / SPL token amounts are proto uint64 fields; the bounded parse
  // rejects an unset ('' -> 0n) or >64-bit amount instead of silently building
  // a zero-value or wrapped transfer.
  const amount = toBoundedLong(keysignPayload.toAmount, { unsigned: true })
  const sender = coin.address
  const recipient = keysignPayload.toAddress

  const getSigningInputCoinSpecificFields = (): Partial<TW.Solana.Proto.SigningInput> => {
    if (!coin.id) {
      return {
        transferTransaction: TW.Solana.Proto.Transfer.create({
          recipient,
          value: amount,
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
      amount,
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
      price: Long.fromString(priorityFeePrice.toString()),
    }),
    priorityFeeLimit: TW.Solana.Proto.PriorityFeeLimit.create({
      limit: computeLimit ? Number(computeLimit) : solanaConfig.priorityFeeLimit,
    }),
    ...getSigningInputCoinSpecificFields(),
  })

  return signingInput
}
