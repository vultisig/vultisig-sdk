import { OtherChain } from '@vultisig/core-chain/Chain'
import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'
import { bytesToHex } from 'viem'

import { TxHashResolver } from '../resolver'

export const getTronTxHash: TxHashResolver<OtherChain.Tron> = ({ id }) =>
  stripHexPrefix(bytesToHex(id))
