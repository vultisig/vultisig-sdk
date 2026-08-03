import { OtherChain, UtxoBasedChain, UtxoChain } from '@vultisig/core-chain/Chain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getChainKind } from '../../../ChainKind'
import { getBlockchairBaseUrl } from '../../../chains/utxo/client/getBlockchairBaseUrl'
import { SigningOutput } from '../../../tw/signingOutput'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type UtxoBasedDecodedTx = SigningOutput<UtxoChain> | SigningOutput<OtherChain.Cardano>

type BlockchairBroadcastResponse =
  | {
      data: {
        transaction_hash: string
      } | null
    }
  | {
      data: null
      context: {
        error: string
      }
    }

export const broadcastUtxoTx: BroadcastTxResolver<UtxoBasedChain> = async ({ chain, tx }) => {
  const url = `${getBlockchairBaseUrl(chain)}/push/transaction`
  const encodedBytes = selectEncodedBytes(chain, tx as UtxoBasedDecodedTx)

  const response = await queryUrl<BlockchairBroadcastResponse>(url, {
    body: {
      data: Buffer.from(encodedBytes).toString('hex'),
    },
  })

  if (response.data) {
    return response.data.transaction_hash
  }

  const error = 'context' in response ? response.context.error : extractErrorMsg(response)

  // Any submit error past this point is ambiguous — it could be a benign MPC-race duplicate (another
  // device already broadcast the same signed tx) OR a genuine failure (e.g. BadInputsUTxO: spent/invalid
  // inputs). String-matching alone can't tell them apart, so verify against the real chain: the hash
  // either resolves on-chain (the race case — success) or it doesn't (the real failure — rethrows).
  const broadcastError = new Error(`Failed to broadcast transaction: ${extractErrorMsg(error)}`)
  await verifyBroadcastByHash({ chain, tx, error: broadcastError })
  return null
}

const hasSigningResultV2 = (
  tx: UtxoBasedDecodedTx
): tx is SigningOutput<UtxoChain> & {
  signingResultV2: { encoded?: Uint8Array | null }
} => tx != null && typeof tx === 'object' && 'signingResultV2' in tx && !!(tx as any).signingResultV2

export const selectEncodedBytes = (chain: UtxoBasedChain, tx: UtxoBasedDecodedTx): Uint8Array => {
  if (getChainKind(chain) === 'utxo' && hasSigningResultV2(tx) && tx.signingResultV2.encoded) {
    return shouldBePresent(tx.signingResultV2.encoded)
  }
  return shouldBePresent(tx.encoded)
}
