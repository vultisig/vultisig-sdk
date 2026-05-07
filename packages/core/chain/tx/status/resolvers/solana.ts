import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

export const getSolanaTxStatus: TxStatusResolver<OtherChain.Solana> = async ({ hash }) => {
  const client = getSolanaClient()

  const { data: signatureStatuses, error: signatureStatusError } = await attempt(
    client.getSignatureStatuses([hash], {
      searchTransactionHistory: true,
    })
  )
  const signatureStatus = signatureStatuses?.value[0]

  if (signatureStatusError || !signatureStatus) {
    return { status: 'pending', isKnown: false }
  }

  if (signatureStatus.err) {
    return { status: 'error', isKnown: true }
  }

  const { data: tx, error } = await attempt(
    client.getTransaction(hash, {
      maxSupportedTransactionVersion: 0,
    })
  )

  if (error || !tx) {
    return { status: 'pending', isKnown: true }
  }

  const meta = tx.meta
  if (!meta) {
    return { status: 'pending', isKnown: true }
  }

  if (meta.err) {
    return { status: 'error', isKnown: true }
  }

  const feeCoin = chainFeeCoin[Chain.Solana]
  const receipt = {
    feeAmount: BigInt(meta.fee),
    feeDecimals: feeCoin.decimals,
    feeTicker: feeCoin.ticker,
  }

  return { status: 'success', receipt }
}
