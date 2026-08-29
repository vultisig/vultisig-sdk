import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW } from '@trustwallet/wallet-core'
import { WalletCore } from '@trustwallet/wallet-core'

import { getKeysignAmount } from '../../../utils/getKeysignAmount'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { toSafeComment, tonAmountToBytes, tonSendMode } from './native'

type BuildJettonTransferInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  jettonAddress: string
  isActiveDestination: boolean
}

/**
 * Builds the transfer that carries a Jetton send: a fixed TON amount to the
 * sender's own Jetton wallet, wrapping the Jetton payload. `forwardAmount` is 1
 * nanoton only when the destination is already active, so an inactive recipient
 * isn't charged for a notification it cannot receive.
 */
export const buildJettonTransfer = ({
  keysignPayload,
  walletCore,
  jettonAddress,
  isActiveDestination,
}: BuildJettonTransferInput): TW.TheOpenNetwork.Proto.Transfer => {
  const coin = getKeysignCoin(keysignPayload)

  const destinationAddress = walletCore.TONAddressConverter.toUserFriendly(keysignPayload.toAddress, true, false)

  const forwardAmount = isActiveDestination ? 1n : 0n

  const jettonTransfer = TW.TheOpenNetwork.Proto.JettonTransfer.create({
    jettonAmount: tonAmountToBytes(shouldBePresent(getKeysignAmount(keysignPayload))),
    toOwner: destinationAddress,
    responseAddress: coin.address,
    forwardAmount: tonAmountToBytes(forwardAmount),
  })

  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: jettonAddress,
    amount: tonAmountToBytes(tonConfig.jettonAmount),
    bounceable: true,
    comment: toSafeComment(keysignPayload.memo ?? ''),
    mode: tonSendMode,
    jettonTransfer,
  })
}
