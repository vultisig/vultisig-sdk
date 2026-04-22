import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { TxHashResolver } from '../resolver'

export const getSuiTxHash: TxHashResolver<OtherChain.Sui> = async ({
  unsignedTx,
}) => {
  const client = await getSuiClient()

  const {
    effects: { transactionDigest },
  } = await client.dryRunTransactionBlock({
    transactionBlock: unsignedTx,
  })

  return transactionDigest
}
