import { DeriveChainKind } from '../../../../chain/ChainKind'
import { FeeQuote } from '../../../../chain/feeQuote/core'
import { Resolver } from '../../../../../lib/utils/types/Resolver'

import {
  ChainsBySpecific,
  KeysignChainSpecific,
  KeysignChainSpecificKey,
} from '../KeysignChainSpecific'

type ValueForCase<C extends KeysignChainSpecificKey> = Extract<
  KeysignChainSpecific,
  { case: C }
>['value']

export type ExtractFeeQuoteResolver<C extends KeysignChainSpecificKey> =
  Resolver<ValueForCase<C>, FeeQuote<DeriveChainKind<ChainsBySpecific<C>>>>
