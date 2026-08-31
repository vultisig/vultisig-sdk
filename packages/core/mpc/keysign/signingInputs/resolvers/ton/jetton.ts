import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW } from '@trustwallet/wallet-core'
import { WalletCore } from '@trustwallet/wallet-core'

import { getKeysignAmount } from '../../../utils/getKeysignAmount'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'
import { toSafeComment, tonAmountToBytes } from './native'

type BuildJettonTransferInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  jettonAddress: string
  isActiveDestination: boolean
}

export const buildJettonTransfer = ({
  keysignPayload,
  walletCore,
  jettonAddress,
  isActiveDestination,
}: BuildJettonTransferInput): TW.TheOpenNetwork.Proto.Transfer => {
  // `TonSpecific.jettonAddress` is a plain proto string that defaults to '' when the
  // sender's jetton wallet could not be resolved, and '' survives every null/undefined
  // check on the way here. Signing that would broadcast a transfer to no destination,
  // so refuse it — including for a payload built by some other device.
  if (!jettonAddress.trim()) {
    throw new Error('Cannot build a TON Jetton transfer: the sender jetton wallet address is missing')
  }

  const coin = getKeysignCoin(keysignPayload)

  const destinationAddress = walletCore.TONAddressConverter.toUserFriendly(keysignPayload.toAddress, true, false)

  const forwardAmount = isActiveDestination ? 1n : 0n

  const jettonTransfer = TW.TheOpenNetwork.Proto.JettonTransfer.create({
    jettonAmount: tonAmountToBytes(shouldBePresent(getKeysignAmount(keysignPayload))),
    toOwner: destinationAddress,
    responseAddress: coin.address,
    forwardAmount: tonAmountToBytes(forwardAmount),
  })

  const mode =
    TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS

  return TW.TheOpenNetwork.Proto.Transfer.create({
    dest: jettonAddress,
    amount: tonAmountToBytes(tonConfig.jettonAmount),
    bounceable: true,
    comment: toSafeComment(keysignPayload.memo ?? ''),
    mode,
    jettonTransfer,
  })
}
