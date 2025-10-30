import { create } from '@bufbuild/protobuf'
import { SuiSpecificSchema } from '../../../../types/vultisig/keysign/v1/blockchain_specific_pb'

import { BuildChainSpecificResolver } from '../resolver'

export const buildSuiSpecific: BuildChainSpecificResolver<'suicheSpecific'> = ({
  feeQuote,
  txData,
}) =>
  create(SuiSpecificSchema, {
    ...txData,
    referenceGasPrice: feeQuote.referenceGasPrice.toString(),
    gasBudget: feeQuote.gasBudget.toString(),
  })
