import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { isNearAccountId, isNearImplicitAccountId } from '@vultisig/core-chain/chains/near/accountId'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { TW } from '@trustwallet/wallet-core'
import { CoinType, WalletCore } from '@trustwallet/wallet-core/dist/src/wallet-core'
import Long from 'long'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SigningInputsResolver } from '../resolver'

const UNSIGNED_DECIMAL = /^\d+$/
const ED25519_PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/

const MAX_U64 = (1n << 64n) - 1n
const MAX_U128 = (1n << 128n) - 1n
const BLOCK_HASH_BYTES = 32
const U128_BYTES = 16

const parseUnsignedBigInt = (value: string, label: string, maximum: bigint) => {
  if (!UNSIGNED_DECIMAL.test(value)) {
    throw new Error(`Invalid NEAR ${label}: ${value} is not an unsigned decimal integer`)
  }

  const parsed = BigInt(value)

  if (parsed > maximum) {
    throw new Error(`Invalid NEAR ${label}: ${value} exceeds the chain's field width`)
  }

  return parsed
}

/** Borsh `u128` deposit: 16 little-endian bytes, the encoding WalletCore expects. */
const encodeU128Le = (value: bigint) => {
  const bytes = new Uint8Array(U128_BYTES)
  let remaining = value

  for (let index = 0; index < U128_BYTES; index += 1) {
    bytes[index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }

  return bytes
}

/**
 * The signer's own account is an implicit account: lowercase hex of the selected
 * Ed25519 public key. Deriving it through WalletCore binds the reviewed address to
 * the key the ceremony actually signs with.
 */
const resolveSignerId = ({
  walletCore,
  coinType,
  address,
  hexPublicKey,
}: {
  walletCore: WalletCore
  coinType: CoinType
  address: string
  hexPublicKey: string
}) => {
  if (!isNearImplicitAccountId(address)) {
    throw new Error(`Invalid NEAR sender address: ${address} is not a 64-character lowercase implicit account`)
  }

  if (!ED25519_PUBLIC_KEY_HEX.test(hexPublicKey)) {
    throw new Error(`Invalid NEAR public key: ${hexPublicKey} is not a 32-byte Ed25519 key in lowercase hex`)
  }

  const publicKey = walletCore.PublicKey.createWithData(
    new Uint8Array(Buffer.from(hexPublicKey, 'hex')),
    walletCore.PublicKeyType.ed25519
  )

  try {
    const derived = walletCore.CoinTypeExt.deriveAddressFromPublicKey(coinType, publicKey)

    if (derived !== address) {
      throw new Error(`NEAR sender address does not match the signing public key: ${address} != ${derived}`)
    }
  } finally {
    publicKey.delete()
  }

  return hexPublicKey
}

/**
 * A SwapKit deposit (NEAR Intents `simpleTransfer`) is signed as the plain
 * transfer it describes, so the swap metadata must name exactly that transfer:
 * same receiver, same amount, and nothing a native transfer could not carry.
 */
const assertSwapKitDepositOnly = (keysignPayload: KeysignPayload) => {
  const { swapPayload } = keysignPayload
  if (swapPayload.case === undefined) return

  if (swapPayload.case !== 'swapkitSwapPayload') {
    throw new Error('NEAR native transfers support SwapKit deposit swaps only')
  }

  const swap = swapPayload.value
  if (swap.fromCoin?.chain !== Chain.Near || !swap.fromCoin.isNativeToken) {
    throw new Error('NEAR SwapKit deposit must sell native NEAR')
  }
  // NEAR Intents deposits go to a fresh per-swap implicit account; a named target is never one.
  if (!isNearImplicitAccountId(swap.targetAddress)) {
    throw new Error(`NEAR SwapKit deposit address ${swap.targetAddress} is not an implicit account`)
  }
  if (swap.targetAddress !== keysignPayload.toAddress) {
    throw new Error(
      `NEAR SwapKit deposit address ${swap.targetAddress} is not the transfer receiver ${keysignPayload.toAddress}`
    )
  }
  if (swap.fromAmount !== keysignPayload.toAmount) {
    throw new Error(
      `NEAR SwapKit deposit amount ${swap.fromAmount} is not the transfer amount ${keysignPayload.toAmount}`
    )
  }
  if (swap.txPayload.length > 0 || swap.txType !== '') {
    throw new Error('NEAR SwapKit deposits are plain transfers and cannot carry a pre-built transaction')
  }
  if (swap.memo) {
    throw new Error('NEAR SwapKit deposits cannot carry a memo')
  }
}

export const getNearSigningInputs: SigningInputsResolver<'near'> = ({ keysignPayload, walletCore }) => {
  const coin = shouldBePresent(keysignPayload.coin)

  if (coin.chain !== Chain.Near || !coin.isNativeToken) {
    throw new Error('NEAR frozen signing supports native NEAR transfers only, not token coin payloads')
  }

  if (keysignPayload.memo) {
    throw new Error('NEAR native transfers cannot carry a memo')
  }

  assertSwapKitDepositOnly(keysignPayload)

  if (keysignPayload.contractPayload.case !== undefined) {
    throw new Error('NEAR native transfers do not support contract payloads')
  }

  if (keysignPayload.signData.case !== undefined) {
    throw new Error('NEAR native transfers do not support custom sign payloads')
  }

  const nearSpecific = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'nearSpecific')

  const receiverId = keysignPayload.toAddress

  if (!isNearAccountId(receiverId)) {
    throw new Error(`Invalid NEAR receiver account id: ${receiverId}`)
  }

  const deposit = parseUnsignedBigInt(keysignPayload.toAmount, 'transfer amount', MAX_U128)

  if (deposit === 0n) {
    throw new Error(`Invalid NEAR transfer amount: ${keysignPayload.toAmount} is not a positive deposit`)
  }

  const nonce = parseUnsignedBigInt(nearSpecific.nonce.toString(), 'nonce', MAX_U64)

  if (nonce === 0n) {
    throw new Error('Invalid NEAR nonce: a signed transaction must carry a positive access-key nonce')
  }

  const blockHash = new Uint8Array(nearSpecific.blockHash)

  if (blockHash.length !== BLOCK_HASH_BYTES) {
    throw new Error(`Invalid NEAR block hash: expected ${BLOCK_HASH_BYTES} bytes, received ${blockHash.length}`)
  }

  // Display metadata: NEAR charges the gas actually burnt, never a fee from the payload.
  parseUnsignedBigInt(nearSpecific.gasFee, 'gas fee', MAX_U128)

  const signerId = resolveSignerId({
    walletCore,
    coinType: getCoinType({ walletCore, chain: Chain.Near }),
    address: shouldBePresent(coin.address),
    hexPublicKey: shouldBePresent(coin.hexPublicKey),
  })

  return [
    TW.NEAR.Proto.SigningInput.create({
      signerId,
      nonce: Long.fromString(nonce.toString(), true),
      receiverId,
      blockHash,
      publicKey: new Uint8Array(Buffer.from(signerId, 'hex')),
      actions: [
        TW.NEAR.Proto.Action.create({
          transfer: TW.NEAR.Proto.Transfer.create({ deposit: encodeU128Le(deposit) }),
        }),
      ],
    }),
  ]
}
