import { Chain } from '@vultisig/core-chain/Chain'
import {
  getThorchainInboundAddress,
  type ThorchainInboundAddress,
} from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import {
  getNativeSwapChainId,
  nativeSwapApiBaseUrl,
  type NativeSwapChain,
} from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { getKeysignSwapPayload, isSecuredAssetWithdrawal } from '@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { VaultError, VaultErrorCode } from '../VaultError'

type GetNativeSwapInboundAddresses = (nativeChain: NativeSwapChain) => Promise<ThorchainInboundAddress[]>

type NativeSwapBroadcastGuardInput = {
  chain: Chain
  keysignPayload: KeysignPayload
  getInboundAddresses?: GetNativeSwapInboundAddresses
  now?: () => number
}

const getDefaultNativeSwapInboundAddresses: GetNativeSwapInboundAddresses = nativeChain => {
  if (nativeChain === Chain.THORChain) {
    return getThorchainInboundAddress()
  }

  return queryUrl(`${nativeSwapApiBaseUrl[nativeChain]}/inbound_addresses`)
}

export const assertNativeSwapReadyForBroadcast = async ({
  chain,
  keysignPayload,
  getInboundAddresses = getDefaultNativeSwapInboundAddresses,
  now = Date.now,
}: NativeSwapBroadcastGuardInput): Promise<void> => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('native' in swapPayload)) {
    return
  }

  const { native } = swapPayload
  // Secured-asset withdrawals use the native payload union as L1 asset metadata,
  // not as a quote. Their MsgDeposit has no quote expiry or inbound vault.
  if (isSecuredAssetWithdrawal({ chain, keysignPayload, native })) {
    return
  }

  const currentSeconds = BigInt(Math.floor(now() / 1000))

  if (typeof native.expirationTime !== 'bigint' || native.expirationTime <= 0n) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      'Native swap quote has a missing or invalid expiration; refresh the quote before broadcasting'
    )
  }

  if (native.expirationTime <= currentSeconds) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      'Native swap quote is expired; refresh the quote before broadcasting'
    )
  }

  if (native.chain !== Chain.THORChain && native.chain !== Chain.MayaChain) {
    return
  }

  const sourceChainId = getNativeSwapChainId(chain)
  if (!sourceChainId) {
    throw new VaultError(
      VaultErrorCode.UnsupportedChain,
      `Cannot validate ${native.chain} inbound vault for unsupported source chain ${chain}`
    )
  }

  const activeInboundAddress = (await getInboundAddresses(native.chain)).find(
    ({ chain }) => chain.toUpperCase() === sourceChainId
  )?.address

  if (!activeInboundAddress) {
    throw new VaultError(
      VaultErrorCode.NetworkError,
      `Cannot validate ${native.chain} inbound vault for source chain ${sourceChainId}`
    )
  }

  if (activeInboundAddress.toLowerCase() !== native.vaultAddress.toLowerCase()) {
    throw new VaultError(
      VaultErrorCode.InvalidVault,
      `${native.chain} inbound vault address changed; refresh the swap quote before broadcasting`
    )
  }
}
