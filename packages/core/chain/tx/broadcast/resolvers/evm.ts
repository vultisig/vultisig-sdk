import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'

import { BroadcastTxResolver } from '../resolver'

export const broadcastEvmTx: BroadcastTxResolver<EvmChain> = async ({
  chain,
  tx,
}) => {
  const client = getEvmClient(chain)

  const { error } = await attempt(
    client.sendRawTransaction({
      serializedTransaction: ensureHexPrefix(
        Buffer.from(tx.encoded).toString('hex')
      ),
    })
  )

  if (
    error &&
    !isInError(
      error,
      'already known',
      'transaction is temporarily banned',
      'nonce too low',
      'transaction already exists',
      'future transaction tries to replace pending',
      'could not replace existing tx',
      'tx already in mempool'
    )
  ) {
    throw error
  }
}
