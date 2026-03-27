import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { BroadcastTxResolver } from '../resolver'

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({
  tx,
}) =>
  getSuiClient().executeTransactionBlock({
    transactionBlock: tx.unsignedTx,
    signature: [tx.signature],
  })
