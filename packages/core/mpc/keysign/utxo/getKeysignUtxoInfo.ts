import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getCardanoExtendedUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoExtendedUtxos'
import type { ChainPlainUtxo } from '@vultisig/core-chain/chains/utxo/tx/ChainPlainUtxo'
import { getUtxos } from '@vultisig/core-chain/chains/utxo/tx/getUtxos'

import { CardanoTokenAssetSchema, UtxoInfo, UtxoInfoSchema } from '../../types/vultisig/keysign/v1/utxo_info_pb'
import { BuildKeysignPayloadError } from '../error'

const utxoHashPattern = /^[0-9a-f]{64}$/i
const maxUint32 = 0xffffffff
const maxInt64 = 0x7fffffffffffffffn

const toUtxoInfo = (plain: { hash: string; amount: bigint; index: number }) =>
  create(UtxoInfoSchema, {
    hash: plain.hash,
    amount: plain.amount,
    index: plain.index,
  })

/**
 * Validates and normalizes a caller-supplied candidate pool of UTXOs.
 *
 * Raised as a [BuildKeysignPayloadError] because bad UTXO input is deterministic
 * and must fail before WalletCore planning rather than retrying or silently
 * falling back to fetching unselected outputs.
 */
export const validateSelectedUtxos = (selectedUtxos: readonly ChainPlainUtxo[]): ChainPlainUtxo[] => {
  if (!Array.isArray(selectedUtxos) || selectedUtxos.length === 0) {
    throw new BuildKeysignPayloadError('utxo-selected-inputs-invalid', 'selectedUtxos must contain at least one UTXO')
  }

  const seenOutpoints = new Set<string>()
  return selectedUtxos.map((utxo, position) => {
    if (!utxo || typeof utxo.hash !== 'string' || !utxoHashPattern.test(utxo.hash)) {
      throw new BuildKeysignPayloadError(
        'utxo-selected-inputs-invalid',
        `Invalid UTXO hash at index ${position}: expected a 64-character hex txid`
      )
    }

    if (typeof utxo.index !== 'number' || !Number.isInteger(utxo.index) || utxo.index < 0 || utxo.index > maxUint32) {
      throw new BuildKeysignPayloadError(
        'utxo-selected-inputs-invalid',
        `Invalid UTXO index at index ${position}: expected a uint32 integer`
      )
    }

    if (typeof utxo.amount !== 'bigint' || utxo.amount <= 0n || utxo.amount > maxInt64) {
      throw new BuildKeysignPayloadError(
        'utxo-selected-inputs-invalid',
        `Invalid UTXO amount at index ${position}: expected a positive int64 bigint`
      )
    }

    const hash = utxo.hash.toLowerCase()
    const outpointKey = `${hash}:${utxo.index}`
    if (seenOutpoints.has(outpointKey)) {
      throw new BuildKeysignPayloadError('utxo-selected-inputs-invalid', `Duplicate UTXO outpoint: ${outpointKey}`)
    }
    seenOutpoints.add(outpointKey)

    return {
      hash,
      index: utxo.index,
      amount: utxo.amount,
    }
  })
}

export const toSelectedUtxoInfo = (selectedUtxos: readonly ChainPlainUtxo[]): UtxoInfo[] =>
  validateSelectedUtxos(selectedUtxos).map(toUtxoInfo)

/**
 * Canonicalize a Koios asset quantity for the keysign wire: iOS parses the
 * string into a BigInt and re-serializes it, so a noncanonical-but-valid
 * value (e.g. "0042") must not leak into the proto bytes. Malformed or
 * negative quantities fail the send here, on the initiator, rather than
 * producing an under-planned body every co-signer would faithfully sign.
 */
const toCanonicalQuantity = (quantity: string): string => {
  const parsed = BigInt(quantity)

  if (parsed < 0n) {
    throw new Error(`Negative Cardano asset quantity from Koios: ${quantity}`)
  }

  return parsed.toString()
}

export const getKeysignUtxoInfo = async ({ chain, address }: ChainAccount) => {
  if (isChainOfKind(chain, 'utxo')) {
    const plain = await getUtxos({ chain, address })
    return plain.map(toUtxoInfo)
  }

  if (chain === Chain.Cardano) {
    const utxos = await getCardanoExtendedUtxos(address)

    return utxos.map(({ hash, amount, index, assets }) =>
      create(UtxoInfoSchema, {
        hash,
        amount,
        index,
        // Per-UTXO native assets ride the keysign payload so every co-signer
        // plans the same token-aware body without hitting Koios itself.
        // Sorted canonically by (policyId, assetNameHex) — mirrors the iOS
        // initiator, keeping the serialized proto bytes deterministic across
        // retries regardless of Koios's per-response asset ordering.
        cardanoTokens: assets
          .map(({ policy_id, asset_name, quantity }) =>
            create(CardanoTokenAssetSchema, {
              // Koios returns both fields hex-encoded; normalize the casing
              // like iOS so identical holdings serialize identically.
              policyId: policy_id.toLowerCase(),
              assetNameHex: asset_name.toLowerCase(),
              amount: toCanonicalQuantity(quantity),
            })
          )
          .sort((a, b) =>
            a.policyId !== b.policyId
              ? a.policyId < b.policyId
                ? -1
                : 1
              : a.assetNameHex < b.assetNameHex
                ? -1
                : a.assetNameHex > b.assetNameHex
                  ? 1
                  : 0
          ),
      })
    )
  }
}
