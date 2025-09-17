import { getChainKind } from '../../../../ChainKind'
import {
  BlockaidSupportedChainKind,
  blockaidSupportedChains,
} from '../../chains'
import { getKeysignChain } from '../../../../../mpc/keysign/utils/getKeysignChain'
import { isOneOf } from '../../../../../../lib/utils/array/isOneOf'

import { BlockaidTxValidationInput } from '../resolver'
import {
  BlockaidTxValidationInputResolver,
  BlockaidTxValidationInputResolverInput,
} from './resolver'
import { getEvmBlockaidTxValidationInput } from './resolvers/evm'
import { getSolanaBlockaidTxValidationInput } from './resolvers/solana'
import { getSuiBlockaidTxValidationInput } from './resolvers/sui'
import { getUtxoBlockaidTxValidationInput } from './resolvers/utxo'

const resolvers: Record<
  BlockaidSupportedChainKind,
  BlockaidTxValidationInputResolver<any>
> = {
  evm: getEvmBlockaidTxValidationInput,
  utxo: getUtxoBlockaidTxValidationInput,
  solana: getSolanaBlockaidTxValidationInput,
  sui: getSuiBlockaidTxValidationInput,
}

export const getBlockaidTxValidationInput = (
  input: Omit<BlockaidTxValidationInputResolverInput, 'chain'>
): BlockaidTxValidationInput | null => {
  const chain = getKeysignChain(input.payload)
  if (!isOneOf(chain, blockaidSupportedChains)) {
    return null
  }

  const chainKind = getChainKind(chain)

  const data = resolvers[chainKind]({
    ...input,
    chain,
  })

  if (!data) {
    return null
  }

  return { chain, data }
}
