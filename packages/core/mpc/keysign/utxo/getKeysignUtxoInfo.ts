import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getCardanoExtendedUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoExtendedUtxos'
import { getUtxos } from '@vultisig/core-chain/chains/utxo/tx/getUtxos'

import { CardanoTokenAssetSchema, UtxoInfoSchema } from '../../types/vultisig/keysign/v1/utxo_info_pb'

const toUtxoInfo = (plain: { hash: string; amount: bigint; index: number }) =>
  create(UtxoInfoSchema, {
    hash: plain.hash,
    amount: plain.amount,
    index: plain.index,
  })

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
