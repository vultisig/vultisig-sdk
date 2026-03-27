import { getChainKind } from '@vultisig/core-chain/ChainKind'
import {
  BlockaidValidationSupportedChainKind,
  blockaidValidationSupportedChains,
} from '@vultisig/core-chain/security/blockaid/validationChains'
import { getKeysignChain } from '@vultisig/core-mpc/keysign/utils/getKeysignChain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'

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
  BlockaidValidationSupportedChainKind,
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
  if (!isOneOf(chain, blockaidValidationSupportedChains)) {
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
