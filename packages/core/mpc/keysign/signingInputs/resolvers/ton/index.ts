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
          })
        )
      : [
          isFeeCoin(coin)
            ? buildNativeTonTransfer({
                keysignPayload,
                bounceable: isStakeOp ? true : !!bounceable,
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
