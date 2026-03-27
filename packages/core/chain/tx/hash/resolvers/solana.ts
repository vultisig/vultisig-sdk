import { OtherChain } from '@vultisig/core-chain/Chain'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { TxHashResolver } from '../resolver'

export const getSolanaTxHash: TxHashResolver<OtherChain.Solana> = ({
  signatures,
}) => shouldBePresent(signatures[0].signature)
