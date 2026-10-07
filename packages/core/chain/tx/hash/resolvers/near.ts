import { OtherChain } from '@vultisig/core-chain/Chain'
import { getNearTransactionHash } from '@vultisig/core-chain/chains/near/signedTransaction'

import { TxHashResolver } from '../resolver'

export const getNearTxHash: TxHashResolver<OtherChain.Near> = tx => getNearTransactionHash(tx.signedTransaction)
