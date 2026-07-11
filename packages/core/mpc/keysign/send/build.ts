import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { normalizeRippleDestination } from '@vultisig/core-chain/chains/ripple/address'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { getCoinBalance } from '@vultisig/core-chain/coin/balance'
import { getChainSpecific } from '@vultisig/core-mpc/keysign/chainSpecific'
import { FeeSettings } from '@vultisig/core-mpc/keysign/chainSpecific/FeeSettings'
import { refineKeysignAmount } from '@vultisig/core-mpc/keysign/refine/amount'
import { refineKeysignUtxo } from '@vultisig/core-mpc/keysign/refine/utxo'
import { getKeysignUtxoInfo } from '@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo'
import { KeysignLibType } from '@vultisig/core-mpc/mpcLib'
import { toCommCoin } from '@vultisig/core-mpc/types/utils/commCoin'
import { TransactionType } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { BuildKeysignPayloadError } from '../error'
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
      })
    : await getChainSpecific({
        keysignPayload,
        feeSettings,
        walletCore,
        destinationTag: effectiveDestinationTag,
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

  return keysignPayload
}
