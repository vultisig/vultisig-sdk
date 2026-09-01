import { isTonStakingComment } from '@vultisig/core-chain/chains/ton/staking'
import { resolveTonWalletVersion, tonMaxMessagesPerRequest } from '@vultisig/core-chain/chains/ton/wallet'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { match } from '@vultisig/lib-utils/match'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignTwPublicKey } from '../../../tw/getKeysignTwPublicKey'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { SigningInputsResolver } from '../../resolver'
import { buildJettonTransfer } from './jetton'
import { buildNativeTonTransfer, buildNativeTonTransferFromMessage } from './native'

export const getTonSigningInputs: SigningInputsResolver<'ton'> = ({ keysignPayload, walletCore }) => {
  const coin = getKeysignCoin(keysignPayload)
  const publicKeyBytes = getKeysignTwPublicKey(keysignPayload)

  // The payload does not say which wallet contract the sender is; its address
  // does. Every co-signer derives the same answer from the shared vault key.
  const walletVersion = resolveTonWalletVersion({
    address: coin.address,
    publicKey: walletCore.PublicKey.createWithData(publicKeyBytes, walletCore.PublicKeyType.ed25519),
    walletCore,
  })

  // `sendMaxAmount` is deliberately not read here. A MAX send is the displayed
  // `balance - fee` carried in `toAmount` like any other amount, so the signed bytes
  // are identical either way and the flag stays descriptive metadata.
  const { expireAt, sequenceNumber, bounceable, jettonAddress, isActiveDestination } = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'tonSpecific'
  )

  const isStakeOp = isTonStakingComment(keysignPayload.memo)

  const signTonMessages =
    keysignPayload.signData?.case === 'signTon' ? keysignPayload.signData.value.tonMessages : undefined

  const messages =
    signTonMessages && signTonMessages.length > 0 && isFeeCoin(coin)
      ? signTonMessages.map(msg =>
          buildNativeTonTransferFromMessage({
            to: msg.to,
            amount: msg.amount,
            payload: msg.payload,
            stateInit: msg.stateInit,
            bounceable: isStakeOp ? true : !!bounceable,
            walletVersion,
          })
        )
      : [
          isFeeCoin(coin)
            ? buildNativeTonTransfer({
                keysignPayload,
                bounceable: isStakeOp ? true : !!bounceable,
                walletVersion,
              })
            : buildJettonTransfer({
                keysignPayload,
                walletCore,
                jettonAddress,
                isActiveDestination,
                walletVersion,
              }),
        ]

  const maxMessages = tonMaxMessagesPerRequest[walletVersion]
  if (messages.length > maxMessages) {
    throw new Error(
      `A ${walletVersion} TON wallet can send at most ${maxMessages} messages per request, got ${messages.length}`
    )
  }

  const input = TW.TheOpenNetwork.Proto.SigningInput.create({
    walletVersion: match(walletVersion, {
      v4r2: () => TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V4_R2,
      v5r1: () => TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V5_R1,
    }),
    expireAt: Number(expireAt.toString()),
    sequenceNumber: Number(sequenceNumber.toString()),
    messages,
    publicKey: publicKeyBytes,
  })

  return [input]
}
