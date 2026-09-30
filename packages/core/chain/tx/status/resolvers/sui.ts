import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { getSuiResultTransaction, isSuiExecutionSuccess } from '@vultisig/core-chain/chains/sui/transactionResult'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

const isMissingSuiTransaction = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false

  const code = 'code' in error ? String(error.code) : undefined
  let message = error.message
  try {
    message = decodeURIComponent(message)
  } catch {
    // Keep the original message when it is not URI encoded.
  }

  return (
    (code === 'NOT_FOUND' && /^Transaction \S+ not found$/i.test(message)) ||
    /Could not find the referenced transaction/i.test(message)
  )
}

export const getSuiTxStatus: TxStatusResolver<OtherChain.Sui> = async ({ hash }) => {
  const client = getSuiClient()

  // `getTransaction` replaces the retired `getTransactionBlock`. An unknown
  // digest rejects rather than resolving to null, so preserve the client error
  // for the conservative classification below.
  const { data, error } = await attempt(
    client.getTransaction({
      digest: hash,
      include: { effects: true },
    })
  )

  // The Sui clients reject an unknown digest with a specific not-found error.
  // Other failures and malformed successful responses prove nothing and remain retryable.
  if (isMissingSuiTransaction(error)) {
    return { status: 'not_found', isKnown: false }
  }

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
