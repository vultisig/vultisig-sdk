import { OtherChain } from '@vultisig/core-chain/Chain'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { assertField } from '@vultisig/lib-utils/record/assertField'

import { getCompiledTxsForBlockaidInput } from '../../../utils/getCompiledTxsForBlockaidInput'
import { BlockaidTxValidationInputResolver } from '../resolver'

export const getSuiBlockaidTxValidationInput: BlockaidTxValidationInputResolver<OtherChain.Sui> = async ({
  payload,
  walletCore,
}) => {
  const coin = assertField(payload, 'coin')

  const compiledTxs = await getCompiledTxsForBlockaidInput({
    payload,
    walletCore,
  })

  const [transaction] = compiledTxs.map(compiledTx => decodeSigningOutput(OtherChain.Sui, compiledTx).unsignedTx)

  return {
    chain: 'mainnet',
    options: ['validation'],
    account_address: coin.address,
    transaction,
    metadata: {},
  }
}
