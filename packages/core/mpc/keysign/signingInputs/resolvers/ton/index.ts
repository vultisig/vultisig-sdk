import { getTonMessageBounceable } from '@vultisig/core-chain/chains/ton/messageBounce'
import { isTonStakingComment } from '@vultisig/core-chain/chains/ton/staking'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { TW } from '@trustwallet/wallet-core'

import { getBlockchainSpecificValue } from '../../../chainSpecific/KeysignChainSpecific'
import { getKeysignTwPublicKey } from '../../../tw/getKeysignTwPublicKey'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { SigningInputsResolver } from '../../resolver'
import { buildJettonTransfer } from './jetton'
import { buildNativeTonTransfer, buildNativeTonTransferFromMessage } from './native'

export const getTonSigningInputs: SigningInputsResolver<'ton'> = ({ keysignPayload, walletCore }) => {
  const coin = getKeysignCoin(keysignPayload)

  const { expireAt, sequenceNumber, bounceable, sendMaxAmount, jettonAddress, isActiveDestination } =
    getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'tonSpecific')

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
            // A dApp declares bounce intent per message, in each destination's own address
            // tag. The wallet-level flag describes only `toAddress` — the first message —
            // and applying it to the whole batch signs the wrong bit on the others.
            bounceable: getTonMessageBounceable(msg.to),
          })
        )
      : [
          isFeeCoin(coin)
            ? buildNativeTonTransfer({
                keysignPayload,
                bounceable: isStakeOp ? true : !!bounceable,
                sendMaxAmount,
              })
            : buildJettonTransfer({
                keysignPayload,
                walletCore,
                jettonAddress,
                isActiveDestination,
              }),
        ]

  const input = TW.TheOpenNetwork.Proto.SigningInput.create({
    walletVersion: TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V4_R2,
    expireAt: Number(expireAt.toString()),
    sequenceNumber: Number(sequenceNumber.toString()),
    messages,
    publicKey: getKeysignTwPublicKey(keysignPayload),
  })

  return [input]
}
