import { getMaxValue } from '@vultisig/core-chain/amount/getMaxValue'
import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import type { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { getSendFeeEstimate } from '@vultisig/core-mpc/keysign/send/getSendFeeEstimate'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { getWalletCore } from '../../context/wasmRuntime'
import type { MaxSendAmount } from '../../types'
import type { VaultIdentity } from './types'

export type GetMaxSendAmountFromKeysParams = {
  coin: AccountCoin
  receiver: string
  memo?: string
  feeSettings?: FeeSettings
}

/**
 * Compute the maximum sendable amount for a coin from raw vault identity fields,
 * without requiring an instantiated vault. Vault-free equivalent of
 * `vault.getMaxSendAmount()`.
 *
 * Fetches the on-chain balance, estimates the send fee at full balance, and
 * returns `balance - fee` (or `0n` if fee exceeds balance).
 */
export const getMaxSendAmountFromKeys = async (
  identity: VaultIdentity,
  params: GetMaxSendAmountFromKeysParams
): Promise<MaxSendAmount> => {
  const walletCore = await getWalletCore()

  const isValid = isValidAddress({
    chain: params.coin.chain,
    address: params.receiver,
    walletCore,
  })
  if (!isValid) {
    throw new Error(`Invalid receiver address for chain ${params.coin.chain}: ${params.receiver}`)
  }

  const balance = await getCoinBalance(params.coin)

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
      })

  const hexPublicKeyOverride = isQbtc
    ? shouldBePresent(identity.publicKeyMldsa, 'Vault MLDSA public key required for QBTC fee estimate')
    : undefined

  const fee = await getSendFeeEstimate({
    coin: params.coin,
    receiver: params.receiver,
    amount: balance,
    memo: params.memo,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    hexPublicKeyOverride,
    walletCore,
    libType: identity.libType,
    feeSettings: params.feeSettings,
  })

  const maxSendable = getMaxValue(balance, fee)

  return { balance, fee, maxSendable }
}
