import { Transaction } from '@mysten/sui/transactions'

import { getSuiClient } from './client'

type BuildSuiTransactionFromJsonInput = {
  /** JSON output of `Transaction.toJSON()` or `Transaction.serialize()` (V1 or V2). */
  transactionJson: string
  /** Sui address of the sender. Used when the serialized transaction omits a sender. */
  sender: string
}

/**
 * Hydrate a serialized Sui Transaction and resolve it to BCS bytes via
 * `Transaction.build({ client })`. Runs inside the SDK so the network call
 * uses the SDK's pinned Sui RPC client and isn't subject to the dApp page's
 * Content Security Policy — callers that run under a dApp's CSP (extension
 * inpage scripts) must route through this from a background context.
 */
export const buildSuiTransactionFromJson = async ({
  transactionJson,
  sender,
}: BuildSuiTransactionFromJsonInput): Promise<Uint8Array> => {
  const tx = Transaction.from(transactionJson)
  tx.setSenderIfNotSet(sender)
  return tx.build({ client: getSuiClient() })
}
