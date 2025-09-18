import { OtherChain } from '../../../Chain'
import { getSolanaClient } from '../../../chains/solana/client'
import { Transaction } from '@solana/web3.js'

import { BroadcastTxResolver } from '../resolver'

export const broadcastSolanaTx: BroadcastTxResolver<
  OtherChain.Solana
> = async ({ tx: { encoded } }) => {
  const client = getSolanaClient()

  const transaction = Transaction.from(Buffer.from(encoded, 'base64'))
  
  await client.sendTransaction(transaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
}
