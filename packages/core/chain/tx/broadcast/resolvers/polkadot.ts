import { OtherChain } from '../../../Chain'
import { getPolkadotClient } from '../../../chains/polkadot/client'
import { attempt } from '../../../../../lib/utils/attempt'
import { isInError } from '../../../../../lib/utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'

export const broadcastPolkadotTx: BroadcastTxResolver<
  OtherChain.Polkadot
> = async ({ tx: { encoded } }) => {
  const client = await getPolkadotClient()

  const { error } = await attempt(client.rpc.author.submitExtrinsic(encoded))

  if (error && !isInError(error, 'Transaction is temporarily banned')) {
    throw error
  }
}
