import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { sendJitoTransaction } from '@vultisig/core-chain/chains/solana/jito'
import base58 from 'bs58'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastSolanaTx: BroadcastTxResolver<
  OtherChain.Solana
> = async ({ chain, tx }) => {
  const rawTransaction = base58.decode(tx.encoded)

  // Route all Solana transactions through JITO's sendTransaction endpoint
  // for free MEV protection (private mempool). Falls back to standard RPC
  // if JITO is unavailable.
  try {
    await sendJitoTransaction(rawTransaction)
    return
  } catch (err) {
    console.warn('[solana] JITO sendTransaction failed, falling back to standard RPC:', err)
  }

  const client = getSolanaClient()
  try {
    await client.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
