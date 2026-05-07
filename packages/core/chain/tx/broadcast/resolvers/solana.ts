import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { sendJitoTransaction } from '@vultisig/core-chain/chains/solana/jito'
import base58 from 'bs58'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastSolanaTx: BroadcastTxResolver<OtherChain.Solana> = async ({ chain, tx }) => {
  const rawTransaction = base58.decode(tx.encoded)

  // Try JITO first for MEV protection, but still relay through standard RPC.
  // JITO can accept sendTransaction without the signature later appearing in
  // public Solana history, so standard RPC propagation is the durable signal.
  try {
    await sendJitoTransaction(rawTransaction)
  } catch (err) {
    console.warn('[solana] JITO sendTransaction failed, falling back to standard RPC:', err)
  }

  const client = getSolanaClient()
  try {
    await client.sendRawTransaction(rawTransaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
