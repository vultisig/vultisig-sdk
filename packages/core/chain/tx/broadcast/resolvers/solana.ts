import { OtherChain } from '../../../Chain'
import { getSolanaClient } from '../../../chains/solana/client'
import base58 from 'bs58'

import { BroadcastTxResolver } from '../resolver'

export const broadcastSolanaTx: BroadcastTxResolver<
  OtherChain.Solana
> = async ({ tx: { encoded } }) => {
  const client = getSolanaClient()

  const rawTransaction = base58.decode(encoded)

  await client.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
}
