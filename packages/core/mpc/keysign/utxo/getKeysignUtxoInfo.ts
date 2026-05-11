import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { ChainAccount } from '@vultisig/core-chain/ChainAccount'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'
import { getCardanoExtendedUtxos } from '@vultisig/core-chain/chains/cardano/utxo/getCardanoExtendedUtxos'
import { getUtxos } from '@vultisig/core-chain/chains/utxo/tx/getUtxos'

import {
  CardanoTokenAssetSchema,
  UtxoInfoSchema,
} from '../../types/vultisig/keysign/v1/utxo_info_pb'

const toUtxoInfo = (plain: {
  hash: string
  amount: bigint
  index: number
}) =>
  create(UtxoInfoSchema, {
    hash: plain.hash,
    amount: plain.amount,
    index: plain.index,
  })

export const getKeysignUtxoInfo = async ({ chain, address }: ChainAccount) => {
  if (isChainOfKind(chain, 'utxo')) {
    const plain = await getUtxos({ chain, address })
    return plain.map(toUtxoInfo)
  }

  if (chain === Chain.Cardano) {
    // The initiator is the only side that hits Koios; per-UTXO token data
    // crosses the wire via UtxoInfo.cardano_tokens so cosigners read identical
    // bytes. Sort tokens canonically by (policyId, assetNameHex) so the proto
    // serialises deterministically — Koios's asset_list ordering isn't
    // stable across responses, and an unstable order across consecutive
    // initiator fetches would invalidate keysign-session retries.
    const plain = await getCardanoExtendedUtxos(address)
    return plain.map(utxo => {
      const sortedAssets = [...utxo.assets].sort((a, b) => {
        if (a.policy_id !== b.policy_id) {
          return a.policy_id < b.policy_id ? -1 : 1
        }
        return a.asset_name < b.asset_name ? -1 : a.asset_name > b.asset_name ? 1 : 0
      })
      return create(UtxoInfoSchema, {
        hash: utxo.hash,
        amount: utxo.amount,
        index: utxo.index,
        cardanoTokens: sortedAssets.map(asset =>
          create(CardanoTokenAssetSchema, {
            policyId: asset.policy_id,
            assetNameHex: asset.asset_name,
            amount: asset.quantity,
          })
        ),
      })
    })
  }
}
