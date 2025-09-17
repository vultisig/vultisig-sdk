import { OtherChain } from '../../../Chain'
import { getSuiClient } from '../../../chains/sui/client'

import { BroadcastTxResolver } from '../resolver'

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({
  tx,
}) =>
  getSuiClient().executeTransactionBlock({
    transactionBlock: tx.unsignedTx,
    signature: [tx.signature],
  })
