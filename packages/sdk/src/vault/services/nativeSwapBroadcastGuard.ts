import { Chain } from '@vultisig/core-chain/Chain'
import {
  getThorchainInboundAddress,
  type ThorchainInboundAddress,
} from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
import {
  nativeSwapApiBaseUrl,
  type NativeSwapChain,
  nativeSwapChainIds,
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

const getNativeSwapChainId = (chain: Chain): string | undefined =>
  nativeSwapChainIds[chain as keyof typeof nativeSwapChainIds]

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

  const activeInbound = (await getInboundAddresses(native.chain)).find(
    ({ chain }) => chain.toUpperCase() === sourceChainId
  )

  if (!activeInbound?.address) {
    throw new VaultError(
      VaultErrorCode.NetworkError,
      `Cannot validate ${native.chain} inbound vault for source chain ${sourceChainId}`
    )
  }

  // sdk#1360: re-check the trading-halt flags at BROADCAST, not only at quote time
  // (findSwapQuote via getNativeSwapTradingHalt). THORChain can HALT<CHAIN>TRADING between the
  // quote and the broadcast (mimir halt, churn, ragnarok) while the inbound vault address stays
  // current - so the address check below would pass and the deposit would broadcast into a halted
  // chain (best case a delayed refund minus outbound fee, worst case stuck funds mid-migration).
  // These flags ride the SAME already-fetched inbound object, so this is fail-closed at zero extra
  // network cost. Any of the three halts on the source-chain inbound aborts the broadcast.
  if (activeInbound.halted || activeInbound.global_trading_paused || activeInbound.chain_trading_paused) {
    throw new VaultError(
      VaultErrorCode.InvalidConfig,
      `${native.chain} trading is halted for ${sourceChainId} (halted=${activeInbound.halted}, ` +
        `global_paused=${activeInbound.global_trading_paused}, chain_paused=${activeInbound.chain_trading_paused}); ` +
        `refusing to broadcast into a halted chain`
    )
  }

  if (activeInbound.address.toLowerCase() !== native.vaultAddress.toLowerCase()) {
    throw new VaultError(
      VaultErrorCode.InvalidVault,
      `${native.chain} inbound vault address changed; refresh the swap quote before broadcasting`
    )
  }
}
