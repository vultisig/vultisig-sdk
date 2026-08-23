import type { WalletCore } from '@trustwallet/wallet-core'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
import { assertSafeDestination } from '@vultisig/core-chain/security/dangerousAddresses'
import { isValidAddress } from '@vultisig/core-chain/utils/isValidAddress'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { buildSendKeysignPayload } from '@vultisig/core-mpc/keysign/send/build'
import type { KeysignPayload } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'

import { getWalletCore } from '../../context/wasmRuntime'
import type { VaultIdentity } from './types'

export type EvmTxNumberish = bigint | number | string

export type RawEvmTxEnvelope = {
  to: string
  value?: EvmTxNumberish
  data?: string
  gasLimit?: EvmTxNumberish
  maxFeePerGas?: EvmTxNumberish
  maxPriorityFeePerGas?: EvmTxNumberish
  nonce?: EvmTxNumberish
}

export type PrepareRawEvmTxFromKeysParams = {
  chain: Parameters<typeof isChainOfKind>[0]
  senderAddress: string
  tx: RawEvmTxEnvelope
}

const toUnsignedBigInt = (value: EvmTxNumberish, field: string): bigint => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${field} must be a non-negative safe integer, bigint, or integer string`)
  }
  if (typeof value === 'string' && !/^(?:0|[1-9]\d*|0x[\da-f]+)$/i.test(value)) {
    throw new Error(`${field} must be a non-negative decimal or 0x-prefixed integer string`)
  }

  const result = BigInt(value)
  if (result < 0n) throw new Error(`${field} cannot be negative`)
  return result
}

/**
 * Build a canonical keysign payload from an already-built raw EVM transaction
 * envelope. Explicit nonce and fee fields replace the network-derived defaults
 * inside this boundary, so callers never need to mutate the returned payload.
 */
export const prepareRawEvmTxFromKeys = async (
  identity: VaultIdentity,
  { chain, senderAddress, tx }: PrepareRawEvmTxFromKeysParams,
  walletCoreOverride?: WalletCore
): Promise<KeysignPayload> => {
  if (!isChainOfKind(chain, 'evm')) {
    throw new Error(`prepareRawEvmTxFromKeys only supports EVM chains. Got: ${chain}`)
  }

  const value = toUnsignedBigInt(tx.value ?? 0n, 'value')
  const data = tx.data ?? '0x'
  if (!/^0x(?:[\da-f]{2})*$/i.test(data)) {
    throw new Error('data must be an even-length 0x-prefixed hex string')
  }

  const gasLimit = tx.gasLimit === undefined ? undefined : toUnsignedBigInt(tx.gasLimit, 'gasLimit')
  if (gasLimit === 0n) throw new Error('gasLimit must be greater than zero')
  const maxFeePerGas = tx.maxFeePerGas === undefined ? undefined : toUnsignedBigInt(tx.maxFeePerGas, 'maxFeePerGas')
  const maxPriorityFeePerGas =
    tx.maxPriorityFeePerGas === undefined
      ? undefined
      : toUnsignedBigInt(tx.maxPriorityFeePerGas, 'maxPriorityFeePerGas')
  const nonce = tx.nonce === undefined ? undefined : toUnsignedBigInt(tx.nonce, 'nonce')

  if (maxFeePerGas !== undefined && maxPriorityFeePerGas !== undefined && maxFeePerGas < maxPriorityFeePerGas) {
    throw new Error('maxFeePerGas cannot be lower than maxPriorityFeePerGas')
  }

  const walletCore = walletCoreOverride ?? (await getWalletCore())
  if (!isValidAddress({ chain, address: tx.to, walletCore })) {
    throw new Error(`Invalid transaction destination for chain ${chain}: ${tx.to}`)
  }
  if (!isValidAddress({ chain, address: senderAddress, walletCore })) {
    throw new Error(`Invalid sender address for chain ${chain}: ${senderAddress}`)
  }
  assertSafeDestination(chain, tx.to)

  const native = chainFeeCoin[chain]
  const publicKey = getPublicKey({
    chain,
    walletCore,
    publicKeys: {
      ecdsa: identity.ecdsaPublicKey,
      eddsa: identity.eddsaPublicKey,
    },
    hexChainCode: identity.hexChainCode,
    chainPublicKeys: identity.chainPublicKeys,
  })

  const payload = await buildSendKeysignPayload({
    coin: {
      chain,
      address: senderAddress,
      decimals: native.decimals,
      ticker: native.ticker,
    },
    receiver: tx.to,
    amount: value,
    memo: data,
    vaultId: identity.ecdsaPublicKey,
    localPartyId: identity.localPartyId,
    publicKey,
    walletCore,
    libType: identity.libType,
  })

  const evmSpecific = getBlockchainSpecificValue(payload.blockchainSpecific, 'ethereumSpecific')
  if (gasLimit !== undefined) evmSpecific.gasLimit = gasLimit.toString()
  if (maxFeePerGas !== undefined) evmSpecific.maxFeePerGasWei = maxFeePerGas.toString()
  if (maxPriorityFeePerGas !== undefined) evmSpecific.priorityFee = maxPriorityFeePerGas.toString()
  if (nonce !== undefined) evmSpecific.nonce = nonce

  if (BigInt(evmSpecific.maxFeePerGasWei) < BigInt(evmSpecific.priorityFee)) {
    throw new Error('maxFeePerGas cannot be lower than maxPriorityFeePerGas')
  }

  return payload
}
