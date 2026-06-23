import { Chain } from '@vultisig/core-chain/Chain'
import {
  getThorchainInboundAddress,
  type ThorchainInboundAddress,
} from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import { nativeSwapChainIds } from '@vultisig/core-chain/swap/native/NativeSwapChain'
import { getKeysignSwapPayload } from '@vultisig/core-mpc/keysign/swap/getKeysignSwapPayload'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

type NativeSwapBroadcastGuardInput = {
  chain: Chain
  keysignPayload: KeysignPayload
  getInboundAddresses?: () => Promise<ThorchainInboundAddress[]>
  now?: () => number
}

const getNativeSwapChainId = (chain: Chain): string | undefined =>
  nativeSwapChainIds[chain as keyof typeof nativeSwapChainIds]

export const assertNativeSwapReadyForBroadcast = async ({
  chain,
  keysignPayload,
  getInboundAddresses = getThorchainInboundAddress,
  now = Date.now,
}: NativeSwapBroadcastGuardInput): Promise<void> => {
  const swapPayload = getKeysignSwapPayload(keysignPayload)
  if (!swapPayload || !('native' in swapPayload)) {
    return
  }

  const { native } = swapPayload
  const currentSeconds = BigInt(Math.floor(now() / 1000))

  if (native.expirationTime > 0n && native.expirationTime <= currentSeconds) {
    throw new Error('Native swap quote is expired; refresh the quote before broadcasting')
  }

  if (native.chain !== Chain.THORChain) {
    return
  }

  const sourceChainId = getNativeSwapChainId(chain)
  if (!sourceChainId) {
    throw new Error(`Cannot validate THORChain inbound vault for unsupported source chain ${chain}`)
  }

  const activeInboundAddress = (await getInboundAddresses()).find(
    ({ chain }) => chain.toUpperCase() === sourceChainId
  )?.address

  if (!activeInboundAddress) {
    throw new Error(`Cannot validate THORChain inbound vault for source chain ${sourceChainId}`)
  }

  if (activeInboundAddress.toLowerCase() !== native.vaultAddress.toLowerCase()) {
    throw new Error('THORChain inbound vault address changed; refresh the swap quote before broadcasting')
  }
}
