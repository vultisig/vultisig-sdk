import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import { attempt } from '@vultisig/lib-utils/attempt'

export type SuiPrebuiltGasData = {
  gasBudget: string
  referenceGasPrice: string
}

/**
 * Read the gas budget and price already baked into a pre-built Sui transaction
 * (a dApp-supplied or SwapKit-supplied PTB, base64 BCS `TransactionData`).
 *
 * Signing never consults these — the bytes are hashed and signed verbatim — but
 * the keysign payload carries them so the fee shown to the user matches what
 * the chain will actually charge. Decoding failures return `undefined` rather
 * than throwing: a display concern must never block an otherwise signable
 * transaction.
 */
export const getSuiPrebuiltGasData = (unsignedTxMsg: string): SuiPrebuiltGasData | undefined => {
  const result = attempt(() => Transaction.from(fromBase64(unsignedTxMsg)).getData().gasData)

  if ('error' in result) {
    return undefined
  }

  const { budget, price } = result.data

  if (!budget) {
    return undefined
  }

  return {
    gasBudget: String(budget),
    referenceGasPrice: price ? String(price) : '',
  }
}
