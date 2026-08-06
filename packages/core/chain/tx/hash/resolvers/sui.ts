import { fromBase64 } from '@mysten/sui/utils'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { getSuiResultTransaction } from '@vultisig/core-chain/chains/sui/transactionResult'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { TxHashResolver } from '../resolver'

export const getSuiTxHash: TxHashResolver<OtherChain.Sui> = async ({ unsignedTx }) => {
  const client = getSuiClient()

  // `simulateTransaction` replaces the retired `dryRunTransactionBlock`. It
  // takes raw BCS bytes rather than a base64 string, and the digest lives on
  // the EFFECTS — the top-level `digest` is not populated for a simulation.
  // A simulation whose execution fails still returns effects carrying the
  // digest, which is exactly what broadcast hash-verification needs, so read
  // it off whichever arm of the result union came back.
  const result = await client.simulateTransaction({
    transaction: fromBase64(unsignedTx),
    include: { effects: true },
  })

  return shouldBePresent(
    getSuiResultTransaction(result)?.effects?.transactionDigest,
    'Sui simulated transaction digest'
  )
}
