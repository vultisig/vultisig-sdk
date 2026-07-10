import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'

import { getKeysignCoin } from './getKeysignCoin'

type ResolvePolkadotToAddressInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

export const resolvePolkadotToAddress = ({ keysignPayload, walletCore }: ResolvePolkadotToAddressInput): string => {
  const { toAddress } = keysignPayload
  const { chain } = getKeysignCoin(keysignPayload)

  // Fail LOUD on a missing/invalid destination. Both callers
  // (getPolkadotSigningInputs, getBittensorSigningInputs) build plain
  // amount+recipient transfers, so there is no legitimate empty-toAddress
  // (e.g. self-bond) case here. The previous fallback returned the SENDER's own
  // address, which would silently sign a transfer whose on-chain destination
  // diverges from the recipient shown on the pre-sign card the user approved -
  // a "sign something other than what was displayed" defect. Rejecting matches
  // the rest of this surface (Sui memo throw, TON comment-length throw,
  // preparePolkadotAssetSend's decodePolkadotAccountId throw).
  const isValid =
    toAddress &&
    isValidAddress({
      chain,
      address: toAddress,
      walletCore,
    })

  if (!isValid) {
    throw new Error(`Invalid ${chain} destination address; refusing to fall back to the sender's own address`)
  }

  return toAddress
}
