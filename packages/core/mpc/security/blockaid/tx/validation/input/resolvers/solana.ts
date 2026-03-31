import { OtherChain } from '@vultisig/core-chain/Chain'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { assertField } from '@vultisig/lib-utils/record/assertField'

import { getCompiledTxsForBlockaidInput } from '../../../utils/getCompiledTxsForBlockaidInput'
import { BlockaidTxValidationInputResolver } from '../resolver'

export const getSolanaBlockaidTxValidationInput: BlockaidTxValidationInputResolver<
  OtherChain.Solana
> = ({ payload, walletCore, chain }) => {
  const coin = assertField(payload, 'coin')

  const transactions = getCompiledTxsForBlockaidInput({
    payload,
    walletCore,
  }).map(tx => decodeSigningOutput(chain, tx).encoded)

  return {
    chain: 'mainnet',
    options: ['validation'],
    account_address: coin.address,
    encoding: 'base58',
    transactions,
    method: 'signAndSendTransaction',
    metadata: {},
  }
}
