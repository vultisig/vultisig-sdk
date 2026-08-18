import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { getSuiResultTransaction, isSuiExecutionSuccess } from '@vultisig/core-chain/chains/sui/transactionResult'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

export const getSuiTxStatus: TxStatusResolver<OtherChain.Sui> = async ({ hash }) => {
  const client = getSuiClient()

  // `getTransaction` replaces the retired `getTransactionBlock`. An unknown
  // digest REJECTS ("missing digest") rather than resolving to null, which the
  // attempt() wrapper already funnels into the not-known branch below.
  const { data, error } = await attempt(
    client.getTransaction({
      digest: hash,
      include: { effects: true },
    })
  )

  if (error || !data) {
    return { status: 'pending', isKnown: false }
  }

  const transaction = getSuiResultTransaction(data)

  if (!transaction) {
    return { status: 'pending', isKnown: false }
  }

  if (isSuiExecutionSuccess(data)) {
    const gasUsed = transaction.effects?.gasUsed
    const feeCoin = chainFeeCoin[Chain.Sui]
    const receipt =
      gasUsed != null &&
      typeof gasUsed === 'object' &&
      'computationCost' in gasUsed &&
      'storageCost' in gasUsed &&
      'storageRebate' in gasUsed
        ? {
            feeAmount:
              BigInt(String(gasUsed.computationCost)) +
              BigInt(String(gasUsed.storageCost)) -
              BigInt(String(gasUsed.storageRebate)),
            feeDecimals: feeCoin.decimals,
            feeTicker: feeCoin.ticker,
          }
        : undefined

    return { status: 'success', receipt }
  }

  // A `FailedTransaction` arm, or an explicit `status.success === false`, is a
  // finalized on-chain failure (MoveAbort / InsufficientGas).
  if (data.$kind === 'FailedTransaction' || transaction.status?.success === false) {
    return { status: 'error' }
  }

  return { status: 'pending', isKnown: true }
}
