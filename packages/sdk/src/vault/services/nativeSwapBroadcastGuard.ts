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
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
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

  const inboundAddresses = await getInboundAddresses(native.chain)
  const inboundByChainId = new Map(inboundAddresses.map(info => [info.chain.toUpperCase(), info]))

  const activeInbound = inboundByChainId.get(sourceChainId.toUpperCase())

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
  // chain. Mirror quote-time's chain selection and evaluate BOTH ends of the route (source AND
  // destination): a source halt is a refused/refunded deposit, but a DESTINATION halt (healthy at
  // quote, halted before broadcast) lets the deposit land while the outbound cannot leave - stuck
  // funds. `native.toCoin.chain` is already on the payload. Tolerance mirrors getNativeSwapTradingHalt:
  // a route leg that resolves to no inbound entry (e.g. RUNE/CACAO, the native chain itself) is not
  // haltable via this feed, so it is skipped rather than false-blocked. `global_trading_paused` is a
  // network-wide flag read across all entries (not just the source). All flags ride the SAME
  // already-fetched inbound object, so this is fail-closed at zero extra network cost.
  const destinationChain = native.toCoin?.chain
  const destinationChainId = destinationChain ? getNativeSwapChainId(destinationChain as Chain) : undefined
  const globalTradingPaused = inboundAddresses.some(info => info.global_trading_paused)
  const routeChainIds = withoutDuplicates(
    [sourceChainId, destinationChainId].filter((id): id is string => id !== undefined).map(id => id.toUpperCase())
  )

  for (const chainId of routeChainIds) {
    const inbound = inboundByChainId.get(chainId)
    if (!inbound) {
      continue
    }
    if (inbound.halted || globalTradingPaused || inbound.chain_trading_paused) {
      throw new VaultError(
        VaultErrorCode.InvalidConfig,
        `${native.chain} trading is halted for ${chainId} (halted=${inbound.halted}, ` +
          `global_paused=${globalTradingPaused}, chain_paused=${inbound.chain_trading_paused}); ` +
          `refusing to broadcast into a halted chain`
      )
    }
  }

  if (activeInbound.address.toLowerCase() !== native.vaultAddress.toLowerCase()) {
    throw new VaultError(
      VaultErrorCode.InvalidVault,
      `${native.chain} inbound vault address changed; refresh the swap quote before broadcasting`
    )
  }
}
