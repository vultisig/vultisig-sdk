import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { decodeTronAddress } from '@vultisig/core-chain/chains/tron/address'
import { decodeTrc20TransferData } from '@vultisig/core-chain/chains/tron/trc20/decodeTrc20TransferData'
import { attempt } from '@vultisig/lib-utils/attempt'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { TW } from '@trustwallet/wallet-core'
import Long from 'long'

import { Coin } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayload } from '../../../types/vultisig/keysign/v1/keysign_message_pb'

// The guard follows vultisig-android's TronContractPayloadGuard so a co-signer
// on any platform refuses the same payloads, and also requires the reviewed
// coin to be TRX itself wherever the bound amount is TRX. The expected shapes
// follow how the extension's TronWeb provider fills `coin` / `toAddress` /
// `toAmount`.

const tronAddressPrefix = 0x41
const trc20TransferDataBytes = 4 + 2 * 32

/** Input for the Tron contract guards: the payload under review and the contract built from it. */
type TronContractReviewInput<T> = {
  keysignPayload: KeysignPayload
  contract: T
}

// Both Base58Check and `41`-prefixed hex reach this point (the provider sends
// hex for a TRC-20 transfer recipient), so addresses compare as their bytes.
const toTronAddressHex = (address: string): string | null => {
  const hex = stripHexPrefix(address)
  if (/^41[0-9a-fA-F]{40}$/.test(hex)) {
    return hex.toLowerCase()
  }

  const result = attempt(() => decodeTronAddress(address))
  if ('error' in result || result.data[0] !== tronAddressPrefix) {
    return null
  }

  return Buffer.from(result.data).toString('hex')
}

const isSameTronAddress = (a: string, b: string) => {
  const left = toTronAddressHex(a)
  return left !== null && left === toTronAddressHex(b)
}

const toBigInt = (value: Long) => BigInt(value.toString())

// `isNativeToken` alone is a flag the payload sets, so a coin shown as another
// ticker could carry it; TRX is pinned by its full identity instead.
const isTrx = (coin: Coin) =>
  coin.chain === Chain.Tron && coin.ticker === 'TRX' && coin.isNativeToken && !coin.contractAddress

const assertOwner = (keysignPayload: KeysignPayload, ownerAddress: string) => {
  const { address } = shouldBePresent(keysignPayload.coin)
  if (!isSameTronAddress(ownerAddress, address)) {
    throw new Error('Tron contract owner is not the vault address')
  }
}

const assertRecipient = (keysignPayload: KeysignPayload, recipient: string) => {
  if (!isSameTronAddress(recipient, keysignPayload.toAddress)) {
    throw new Error('Tron contract recipient does not match the reviewed toAddress')
  }
}

// `BigInt('')` is 0n, so the reviewed amount must be a plain decimal string.
const assertAmount = (keysignPayload: KeysignPayload, amount: bigint) => {
  const { toAmount } = keysignPayload
  if (!/^\d+$/.test(toAmount) || BigInt(toAmount) !== amount) {
    throw new Error('Tron contract amount does not match the reviewed toAmount')
  }
}

/**
 * Refuses a dApp `TransferContract` unless its owner is the vault and its
 * recipient and amount are the ones the review shows, as native TRX.
 */
export const assertTronTransferMatchesReview = ({
  keysignPayload,
  contract,
}: TronContractReviewInput<TW.Tron.Proto.TransferContract>) => {
  assertOwner(keysignPayload, contract.ownerAddress)
  if (!isTrx(shouldBePresent(keysignPayload.coin))) {
    throw new Error('Tron TransferContract must be reviewed as TRX')
  }
  assertRecipient(keysignPayload, contract.toAddress)
  assertAmount(keysignPayload, toBigInt(contract.amount))
}

/**
 * Refuses a dApp `TransferAssetContract` unless its owner is the vault and its
 * recipient and amount are the ones the review shows. The payload carries no
 * TRC-10 id to bind `assetName` to, so the coin is only required not to be TRX.
 */
export const assertTronTransferAssetMatchesReview = ({
  keysignPayload,
  contract,
}: TronContractReviewInput<TW.Tron.Proto.TransferAssetContract>) => {
  assertOwner(keysignPayload, contract.ownerAddress)
  if (shouldBePresent(keysignPayload.coin).isNativeToken) {
    throw new Error('Tron TransferAssetContract must not be reviewed as TRX')
  }
  assertRecipient(keysignPayload, contract.toAddress)
  assertAmount(keysignPayload, toBigInt(contract.amount))
}

/**
 * Refuses a dApp `TriggerSmartContract` whose signed call disagrees with the
 * review. A TRC-20 `transfer` is bound by the recipient and amount decoded from
 * its data and must be reviewed as that token with no TRX attached; any other
 * call is reviewed as TRX, the attached `call_value`, sent to the contract
 * address. TRC-10 value attached to a call has nothing to show it, so it is
 * refused.
 */
export const assertTronContractCallMatchesReview = ({
  keysignPayload,
  contract,
}: TronContractReviewInput<TW.Tron.Proto.TriggerSmartContract>) => {
  assertOwner(keysignPayload, contract.ownerAddress)
  if (!contract.callTokenValue.isZero()) {
    throw new Error('Tron contract call must not attach TRC-10 tokens')
  }

  const coin = shouldBePresent(keysignPayload.coin)
  const callValue = toBigInt(contract.callValue)
  const transfer =
    contract.data.length >= trc20TransferDataBytes
      ? decodeTrc20TransferData(Buffer.from(contract.data).toString('hex'))
      : null

  if (!transfer) {
    if (!isTrx(coin)) {
      throw new Error('Tron contract call must be reviewed as TRX')
    }
    assertRecipient(keysignPayload, contract.contractAddress)
    assertAmount(keysignPayload, callValue)
    return
  }

  if (callValue !== 0n) {
    throw new Error('TRC-20 transfer must not attach TRX')
  }
  if (coin.isNativeToken || !isSameTronAddress(coin.contractAddress, contract.contractAddress)) {
    throw new Error('TRC-20 transfer contract does not match the reviewed token')
  }
  assertRecipient(keysignPayload, transfer.recipient)
  assertAmount(keysignPayload, transfer.amount)
}
