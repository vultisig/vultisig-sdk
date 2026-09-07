import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { normalizeRippleDestination } from '@vultisig/core-chain/chains/ripple/address'
import { getSignableIssuedCurrencyAmount, parseRippleTokenId } from '@vultisig/core-chain/chains/ripple/issuedCurrency'
import { validateTonComment } from '@vultisig/core-chain/chains/ton/comment'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { refineKeysignAmount } from '@vultisig/core-mpc/keysign/refine/amount'
import { refineKeysignUtxo } from '@vultisig/core-mpc/keysign/refine/utxo'
import { getKeysignUtxoInfo } from '@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { TransactionType } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload, KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'
import { BuildKeysignPayloadError } from '../error'
import { getKeysignAmount } from '../utils/getKeysignAmount'
import { validateDestinationTag } from '../utils/rippleDestinationTag'
import { getCosmosWasmTokenTransferPayload } from './cosmosWasm'

export type BuildSendKeysignPayloadInput = {
  coin: AccountCoin
  receiver: string
  amount: bigint
  memo?: string
  /** XRPL DestinationTag, kept independent from the free-text memo. */
  destinationTag?: number
  vaultId: string
  localPartyId: string
  publicKey: PublicKey | null
  /** When `publicKey` is null (e.g. MLDSA-only chain), supply raw hex for `coin.hexPublicKey`. */
  hexPublicKeyOverride?: string
  libType: KeysignLibType
  walletCore: WalletCore
  feeSettings?: FeeSettings
  /**
   * Whether the caller's UI offered this as a MAX send. Recorded in TonSpecific;
   * the amount signed is `amount` either way, so this describes the send rather
   * than changing it.
   */
  sendMaxAmount?: boolean
}

type AssertTonMemoFitsInput = {
  coin: AccountCoin
  keysignPayload: KeysignPayload
}

/**
 * Rejects a TON memo that will not fit the cell it is destined for, while the
 * payload is still being built.
 *
 * Without this the only check is in the signing-input resolver, which runs
 * after the user has reviewed and approved the transaction — an oversized
 * jetton memo surfaces there as a bare WalletCore "Internal error". Deferred to
 * the end of the build because the jetton cap depends on the final signed
 * amount and on `isActiveDestination`, which `getChainSpecific` resolves.
 *
 * Raised as a [BuildKeysignPayloadError] because it is bad input, not a
 * transient failure: callers stop retrying and show it.
 */
const assertTonMemoFits = ({ coin, keysignPayload }: AssertTonMemoFitsInput): void => {
  const { memo } = keysignPayload
  if (coin.chain !== Chain.Ton || !memo) {
    return
  }

  const { isActiveDestination } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'tonSpecific')

  try {
    validateTonComment({
      memo,
      jetton: isFeeCoin(coin) ? undefined : { amount: getKeysignAmount(keysignPayload), isActiveDestination },
    })
  } catch (error) {
    // Re-raised as a domain error so callers stop retrying and show it; the
    // validator's message already names the real cap and the actual length.
    throw new BuildKeysignPayloadError('ton-memo-too-long', error instanceof Error ? error.message : String(error))
  }
}

export const buildSendKeysignPayload = async ({
  coin,
  receiver,
  amount,
  memo,
  destinationTag,
  vaultId,
  localPartyId,
  publicKey,
  hexPublicKeyOverride,
  walletCore,
  libType,
  feeSettings,
  sendMaxAmount,
}: BuildSendKeysignPayloadInput) => {
  const hexPublicKey = hexPublicKeyOverride ?? (publicKey ? Buffer.from(publicKey.data()).toString('hex') : undefined)
  if (!hexPublicKey) {
    throw new Error('buildSendKeysignPayload requires publicKey or hexPublicKeyOverride')
  }

  const rippleDestination = coin.chain === Chain.Ripple ? normalizeRippleDestination(receiver) : undefined
  const normalizedReceiver = rippleDestination?.address ?? receiver
  const embeddedDestinationTag = rippleDestination?.destinationTag
  if (
    embeddedDestinationTag !== undefined &&
    destinationTag !== undefined &&
    embeddedDestinationTag !== destinationTag
  ) {
    throw new BuildKeysignPayloadError(
      'ripple-destination-tag-invalid',
      `Conflicting XRP destination tags: X-address ${embeddedDestinationTag}, field ${destinationTag}`
    )
  }
  const effectiveDestinationTag = destinationTag ?? embeddedDestinationTag
  if (effectiveDestinationTag !== undefined) validateDestinationTag(effectiveDestinationTag)

  // Reject an amount the ledger cannot carry exactly while the payload is still
  // being built, so the user sees why instead of a WalletCore error after
  // review. Raised as a [BuildKeysignPayloadError] because it is bad input, not
  // a transient failure: callers stop retrying and show it.
  if (coin.chain === Chain.Ripple && coin.id) {
    const tokenId = coin.id
    const signable = attempt(() => {
      if (amount <= 0n) {
        throw new Error('XRP issued-currency Payment amount must be positive')
      }

      return getSignableIssuedCurrencyAmount({ ...parseRippleTokenId(tokenId), amount, decimals: coin.decimals })
    })

    if ('error' in signable) {
      throw new BuildKeysignPayloadError(
        'ripple-issued-currency-amount-invalid',
        signable.error instanceof Error ? signable.error.message : String(signable.error)
      )
    }
  }

  const cosmosWasmTokenTransferPayload = getCosmosWasmTokenTransferPayload({
    coin,
    receiver: normalizedReceiver,
    amount,
  })

  // Keep tag-only XRP sends compatible with legacy signers that do not read
  // RippleSpecific.destinationTag yet. An explicit memo remains independent
  // when it differs from the tag; an equal memo is treated as the compatibility
  // carrier by the signing-input resolver.
  const keysignMemo = memo || (coin.chain === Chain.Ripple ? effectiveDestinationTag?.toString() : undefined)

  let keysignPayload = create(KeysignPayloadSchema, {
    coin: toCommCoin({
      ...coin,
      hexPublicKey,
    }),
    toAddress: normalizedReceiver,
    toAmount: amount.toString(),
    memo: keysignMemo,
    vaultLocalPartyId: localPartyId,
    vaultPublicKeyEcdsa: vaultId,
    libType,
    utxoInfo: await getKeysignUtxoInfo(coin),
    contractPayload: cosmosWasmTokenTransferPayload
      ? {
          case: 'wasmExecuteContractPayload',
          value: cosmosWasmTokenTransferPayload,
        }
      : undefined,
  })

  keysignPayload.blockchainSpecific = cosmosWasmTokenTransferPayload
    ? await getChainSpecific({
        keysignPayload,
        walletCore,
        transactionType: TransactionType.GENERIC_CONTRACT,
        destinationTag: effectiveDestinationTag,
        sendMaxAmount,
      })
    : await getChainSpecific({
        keysignPayload,
        feeSettings,
        walletCore,
        destinationTag: effectiveDestinationTag,
        sendMaxAmount,
        ...(coin.chain === Chain.Ripple ? { transactionType: TransactionType.RIPPLE_PAYMENT } : {}),
      })

  const balance = await getCoinBalance(coin)

  if (publicKey) {
    keysignPayload = await refineKeysignAmount({
      keysignPayload,
      walletCore,
      publicKey,
      balance,
    })

    if (isChainOfKind(coin.chain, 'utxo')) {
      keysignPayload = await refineKeysignUtxo({
        keysignPayload,
        walletCore,
        publicKey,
      })
    }
  }

  assertTonMemoFits({ coin, keysignPayload })

  return keysignPayload
}
