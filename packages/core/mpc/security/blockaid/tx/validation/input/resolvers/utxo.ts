import { Buffer } from 'buffer'
import { UtxoChain } from '@vultisig/core-chain/Chain'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { getKeysignCoin } from '@vultisig/core-mpc/keysign/utils/getKeysignCoin'

import { getCompiledTxsForBlockaidInput } from '../../../utils/getCompiledTxsForBlockaidInput'
import { BlockaidTxValidationInputResolver } from '../resolver'

export const getUtxoBlockaidTxValidationInput: BlockaidTxValidationInputResolver<UtxoChain.Bitcoin> = async ({
  payload,
  walletCore,
  chain,
}) => {
  const { address } = getKeysignCoin(payload)

  const compiledTxs = await getCompiledTxsForBlockaidInput({
    payload,
    walletCore,
  })

  const [transaction] = compiledTxs.map(compiledTx => decodeSigningOutput(chain, compiledTx).encoded)

  return {
    chain: chain.toLowerCase(),
    options: ['validation'],
    account_address: address,
    transaction: Buffer.from(transaction).toString('hex'),
    metadata: {},
  }
}
