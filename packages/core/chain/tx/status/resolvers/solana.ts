import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getSolanaClient } from '@vultisig/core-chain/chains/solana/client'
import { withSolanaRpcTimeout } from '@vultisig/core-chain/chains/solana/rpcTimeout'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import base58 from 'bs58'

import { TxStatusResolver } from '../resolver'

type SolanaClient = ReturnType<typeof getSolanaClient>

const isSolanaSignature = (hash: string): boolean => {
  try {
    return base58.decode(hash).length === 64
  } catch {
    return false
  }
}

// Every RPC call here is bounded: a stalled request reads as unavailable
// information and the transaction stays pending, the same way a failed one
// does. Without that, one half-open socket could hold a status poll open for
// good, and with it the confirmation wait of whatever is polling.
const readSignatureStatus = (client: SolanaClient, hash: string) =>
  attempt(async () => {
    const { value } = await withSolanaRpcTimeout(
      client.getSignatureStatuses([hash], { searchTransactionHistory: true }),
      'getSignatureStatuses'
    )
    return value[0]
  })

const isExpiredLastValidBlockHeight = async (
  client: SolanaClient,
  lastValidBlockHeight: number | undefined
): Promise<boolean> => {
  const height = lastValidBlockHeight

  if (height == null || !Number.isSafeInteger(height) || height < 0) {
    return false
  }

  const { data: currentBlockHeight, error } = await attempt(
    withSolanaRpcTimeout(client.getBlockHeight(), 'getBlockHeight')
  )

  return !error && typeof currentBlockHeight === 'number' && currentBlockHeight > height
}

export const getSolanaTxStatus: TxStatusResolver<OtherChain.Solana> = async ({ hash, lastValidBlockHeight }) => {
  // A string that is not a 64-byte base58 signature can never have an on-chain record;
  // deciding this locally avoids trusting a provider's generic invalid-params error for a live transaction.
  if (!isSolanaSignature(hash)) {
    return { status: 'not_found', isKnown: false }
  }

  const client = getSolanaClient()

  const { data: firstSighting, error: firstLookupError } = await readSignatureStatus(client, hash)

  if (firstLookupError) {
    return { status: 'pending', isKnown: false }
  }

  let signatureStatus = firstSighting

  if (!signatureStatus) {
    // A history search with no broadcast expiry context is the node's
    // authoritative answer that it has no record of this signature.
    if (lastValidBlockHeight == null) {
      return { status: 'not_found', isKnown: false }
    }

    if (!(await isExpiredLastValidBlockHeight(client, lastValidBlockHeight))) {
      return { status: 'pending', isKnown: false }
    }

    // That absence was observed BEFORE the height, and a transaction can land
    // in its last valid block while the height request is in flight. Only an
    // absence observed once the chain is already past the deadline is
    // permanent, so read history again now. A failed re-read proves nothing
    // and stays pending: `expired` is terminal, and its documented recovery
    // is to sign again, which would pay twice for a transfer that did land.
    const { data: recheckedSighting, error: recheckError } = await readSignatureStatus(client, hash)

    if (recheckError) {
      return { status: 'pending', isKnown: false }
    }

    if (!recheckedSighting) {
      // Past its last valid block height an unseen signature can never land:
      // that is the chain's own terminal verdict, and every consumer treats
      // `expired` as final. `not_found` would read as "not propagated yet" and
      // keep the transaction polling as pending for good.
      return { status: 'expired', isKnown: false }
    }

    signatureStatus = recheckedSighting
  }

  if (signatureStatus.err) {
    return { status: 'error', isKnown: true }
  }

  const { data: tx, error } = await attempt(
    withSolanaRpcTimeout(client.getTransaction(hash, { maxSupportedTransactionVersion: 0 }), 'getTransaction')
  )

  if (error || !tx) {
    return { status: 'pending', isKnown: true }
  }

  const meta = tx.meta
  if (!meta) {
    return { status: 'pending', isKnown: true }
  }

  if (meta.err) {
    return { status: 'error', isKnown: true }
  }

  const feeCoin = chainFeeCoin[Chain.Solana]
  const receipt = {
    feeAmount: BigInt(meta.fee),
    feeDecimals: feeCoin.decimals,
    feeTicker: feeCoin.ticker,
  }

  return { status: 'success', receipt }
}
