import { OtherChain } from '@vultisig/core-chain/Chain'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { assertField } from '@vultisig/lib-utils/record/assertField'

import { getCompiledTxsForBlockaidInput } from '../../../utils/getCompiledTxsForBlockaidInput'
import { BlockaidTxSimulationInputResolver } from '../resolver'

export const getSuiBlockaidTxSimulationInput: BlockaidTxSimulationInputResolver<OtherChain.Sui> = async ({
  payload,
  walletCore,
}) => {
  const coin = assertField(payload, 'coin')

  const compiledTxs = await getCompiledTxsForBlockaidInput({
    payload,
    walletCore,
  })
  if (compiledTxs.length === 0) return null

  const [transaction] = compiledTxs.map(compiledTx => decodeSigningOutput(OtherChain.Sui, compiledTx).unsignedTx)

  return {
    chain: 'mainnet',
    options: ['simulation'],
    account_address: coin.address,
    transaction,
    metadata: {},
  }
}
