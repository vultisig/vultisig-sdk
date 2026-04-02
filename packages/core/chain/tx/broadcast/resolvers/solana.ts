import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import {
  sendJitoTransaction,
  type BroadcastHint,
} from '@vultisig/core-chain/chains/solana/jito'
import base58 from 'bs58'

import { BroadcastTxResolver } from '../resolver'

export const broadcastSolanaTx: BroadcastTxResolver<
  OtherChain.Solana
> = async ({ tx: { encoded }, broadcastHint }) => {
  const rawTransaction = base58.decode(encoded)
  // Default to jito_send for all Solana transactions (free MEV protection).
  // When the MCP broadcast_hint is threaded through, this default only applies
  // to SDK-internal flows (send, swap) that don't pass a hint yet.
  const hint: BroadcastHint = (broadcastHint as BroadcastHint) ?? 'jito_send'

  switch (hint) {
    case 'jito_send':
      try {
        await sendJitoTransaction(rawTransaction)
        return
      } catch {
        // Fallback to standard RPC if JITO endpoint fails
        break
      }
    case 'jito_bundle':
      // Bundle support requires a tip transaction + second signing round.
      // When called from the basic broadcastTx path (which only has a single
      // signed tx), we fall back to jito_send for MEV protection.
      try {
        await sendJitoTransaction(rawTransaction)
        return
      } catch {
        break
      }
    case 'standard':
    default:
      break
  }

  // Standard RPC broadcast (default + fallback)
  const client = getSolanaClient()
  await client.sendRawTransaction(rawTransaction, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
}
