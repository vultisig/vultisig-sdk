import type { WalletCore } from '@trustwallet/wallet-core'
import { getMaxValue } from '@vultisig/core-chain/amount/getMaxValue'
import { Chain } from '@vultisig/core-chain/Chain'
import { isTerraClassicUstcCoin } from '@vultisig/core-chain/chains/cosmos/terraClassicTax'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
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
  destinationTag?: number
  feeSettings?: FeeSettings
}

export type ComputeMaxSendFromBalanceParams = GetMaxSendAmountFromKeysParams & {
  balance: bigint
  nativeBalance?: bigint
}

/**
 * Compute max-send given a pre-fetched balance. Used by `VaultBase.getMaxSendAmount`
 * so the vault layer can go through `BalanceService.getBalance` (cached + event-emitting
 * + VaultError-wrapped) instead of hitting `getCoinBalance` directly here.
 *
 * Vault-free callers should prefer `getMaxSendAmountFromKeys`, which fetches balance
 * itself.
 */
export const computeMaxSendFromBalance = async (
  identity: VaultIdentity,
  params: ComputeMaxSendFromBalanceParams,
  walletCoreOverride?: WalletCore
): Promise<MaxSendAmount> => {
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
    ? shouldBePresent(identity.publicKeyMldsa, 'Vault MLDSA public key required for QBTC fee estimate')
    : undefined

  const fee = await getSendFeeEstimate({
    coin: params.coin,
    receiver: params.receiver,
    amount: params.balance,
    memo: params.memo,
    destinationTag: params.destinationTag,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    hexPublicKeyOverride,
    walletCore,
    libType: identity.libType,
    feeSettings: params.feeSettings,
  })

  // TerraClassic USTC pays its fee (base gas + burn tax) in `uusd` — the same
  // denom/balance being sent — unlike every other non-fee-coin token, which
  // pays gas from a separate native balance. Treat it like a native send: no
  // native-balance gas check, and the fee comes out of the same balance.
  const paysFeeInOwnBalance = isFeeCoin(params.coin) || isTerraClassicUstcCoin(params.coin)
  const isTokenSend = !paysFeeInOwnBalance
  if (isTokenSend) {
    const native = chainFeeCoin[params.coin.chain]
    const nativeBalance = shouldBePresent(params.nativeBalance, `Native ${native.ticker} balance for token max-send`)
    if (nativeBalance < fee) {
      throw new Error(
        `Insufficient native ${native.ticker} balance for gas: ${nativeBalance} available, ${fee} required`
      )
    }
  }

  const maxSendable = isTokenSend ? params.balance : getMaxValue(params.balance, fee)

  return { balance: params.balance, fee, maxSendable }
}

/**
 * Compute the maximum sendable amount for a coin from raw vault identity fields,
 * without requiring an instantiated vault. Vault-free equivalent of
 * `vault.getMaxSendAmount()`.
 *
 * Fetches the on-chain balance and estimates the send fee at full balance.
 * Native sends return `balance - fee` (or `0n` if fee exceeds balance). Token
 * sends return the full token balance after verifying the native balance can
 * cover the fee.
 *
 * `walletCore` is optional; when omitted, falls back to the SDK's globally-configured
 * `getWalletCore()` (used by MCP / vault-free callers). Wrappers with an injected
 * `WasmProvider` should pass it explicitly.
 */
export const getMaxSendAmountFromKeys = async (
  identity: VaultIdentity,
  params: GetMaxSendAmountFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<MaxSendAmount> => {
  const walletCore = walletCoreOverride ?? (await getWalletCore())
  // Receiver validation lives in computeMaxSendFromBalance (the canonical check
  // for all callers) — don't duplicate it here.
  const balance = await getCoinBalance(params.coin)
  const nativeBalance =
    isFeeCoin(params.coin) || isTerraClassicUstcCoin(params.coin)
      ? undefined
      : await getCoinBalance({ ...chainFeeCoin[params.coin.chain], address: params.coin.address })
  return computeMaxSendFromBalance(identity, { ...params, balance, nativeBalance }, walletCore)
}
