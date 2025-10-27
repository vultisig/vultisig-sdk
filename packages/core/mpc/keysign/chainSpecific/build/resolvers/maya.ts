import { create } from '@bufbuild/protobuf'
import { MAYAChainSpecificSchema } from '../../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { BuildChainSpecificResolver } from '../resolver'

export const buildMayaSpecific: BuildChainSpecificResolver<'mayaSpecific'> = ({
  txData,
}) => create(MAYAChainSpecificSchema, txData)
