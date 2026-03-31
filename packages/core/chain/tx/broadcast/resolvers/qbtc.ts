import { StargateClient } from '@cosmjs/stargate'
import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcTendermintRpcUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'

export const broadcastQbtcTx: BroadcastTxResolver<typeof Chain.QBTC> = async ({
  tx: { serialized },
}) => {
  const { tx_bytes } = JSON.parse(serialized)
  const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

  const client = await StargateClient.connect(qbtcTendermintRpcUrl)
  const { error } = await attempt(client.broadcastTx(decodedTxBytes))

  if (error && !isInError(error, 'tx already exists in cache')) {
    throw error
  }
}
