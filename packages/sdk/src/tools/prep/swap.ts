import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import type { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { buildSwapKeysignPayload } from '@vultisig/core-mpc/keysign/swap/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type PrepareSwapTxFromKeysParams = {
  fromCoin: AccountCoin
  toCoin: AccountCoin
  amount: string | number
  swapQuote: SwapQuote
}

/**
 * Build a swap-transaction `KeysignPayload` from raw vault identity fields,
 * without requiring an instantiated vault. This is the vault-free equivalent of
 * the payload-building portion of `SwapService.prepareSwapTx` and is intended
 * for MCP servers and other contexts where only the public identity (no key
 * shares) is available.
 *
 * Coin-input resolution must be performed by the caller — the vault layer owns
 * that responsibility because it requires `getAddress`. Quote expiry validation
 * is also a consumer concern.
 *
 * If the swap requires an ERC-20 approval, the resulting payload will have
 * `erc20ApprovePayload` set by core; this wrapper returns the payload as-is
 * without extracting it.
 *
 * Note: swaps don't apply to QBTC, so both public keys are always non-null.
 */
export const prepareSwapTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareSwapTxFromKeysParams
): Promise<KeysignPayload> => {
  const walletCore = await getWalletCore()

  const fromPublicKey = getPublicKey({
    chain: params.fromCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
  })

  const toPublicKey = getPublicKey({
    chain: params.toCoin.chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
  })

  return buildSwapKeysignPayload({
    fromCoin: params.fromCoin,
    toCoin: params.toCoin,
    amount: params.amount,
    swapQuote: params.swapQuote,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    fromPublicKey,
    toPublicKey,
    libType: identity.libType,
    walletCore,
  })
}
