import type { WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import type { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type PrepareSendTxFromKeysParams = {
  coin: AccountCoin
  receiver: string
  amount: bigint
  memo?: string
  feeSettings?: FeeSettings
}

/**
 * Build a send-transaction `KeysignPayload` from raw vault identity fields,
 * without requiring an instantiated vault. This is the vault-free equivalent of
 * `vault.transactionBuilder.prepareSendTx()` and is intended for MCP servers and
 * other contexts where only the public identity (no key shares) is available.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 *
 * @example
 * ```ts
 * const payload = await prepareSendTxFromKeys(identity, {
 *   coin: { chain: 'Ethereum', address: '0x...', decimals: 18, ticker: 'ETH' },
 *   receiver: '0x...',
 *   amount: 1500000000000000000n,
 * })
 * ```
 */
export const prepareSendTxFromKeys = async (
  identity: VaultIdentity,
  params: PrepareSendTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  if (params.amount <= 0n) {
    throw new Error('Amount must be greater than zero')
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())

  const isValid = isValidAddress({
    chain: params.coin.chain,
    address: params.receiver,
    walletCore,
  })
  if (!isValid) {
    throw new Error(`Invalid receiver address for chain ${params.coin.chain}: ${params.receiver}`)
  }

  const isQbtc = params.coin.chain === Chain.QBTC

  const publicKey = isQbtc
    ? null
    : getPublicKey({
        chain: params.coin.chain,
        walletCore,
        publicKeys: {
          ecdsa: identity.ecdsaPublicKey,
          eddsa: identity.eddsaPublicKey,
        },
        hexChainCode: identity.hexChainCode,
        chainPublicKeys: identity.chainPublicKeys,
      })

  const hexPublicKeyOverride = isQbtc
    ? shouldBePresent(identity.publicKeyMldsa, 'Vault MLDSA public key required for QBTC send')
    : undefined

  return buildSendKeysignPayload({
    coin: params.coin,
    receiver: params.receiver,
    amount: params.amount,
    memo: params.memo,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    hexPublicKeyOverride,
    walletCore,
    libType: identity.libType,
    feeSettings: params.feeSettings,
  })
}
