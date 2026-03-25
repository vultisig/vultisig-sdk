/**
 * Shared send logic for funded E2E: tokens first, then native (minimal amounts).
 */

import { Chain } from '@core/chain/Chain'
import type { AccountCoin } from '@core/chain/coin/AccountCoin'
import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

import type { Balance } from '@/types'

import { VaultBase } from '../../../src/vault/VaultBase'
import {
  BROADCAST_COOLDOWN_MS,
  collectTokenEntries,
  resolveNativeSendAmount,
  resolveTokenSendAmount,
  sleep,
} from './helpers'

export type SignBroadcastFn = (params: {
  vault: VaultBase
  chain: Chain
  keysignPayload: KeysignPayload
}) => Promise<string>

async function buildNativeCoin(vault: VaultBase, chain: Chain): Promise<AccountCoin> {
  const address = await vault.address(chain)
  const b = await vault.balance(chain)
  return {
    chain,
    address,
    decimals: b.decimals,
    ticker: b.symbol,
  }
}

async function buildTokenCoin(
  vault: VaultBase,
  chain: Chain,
  tokenId: string,
  balance: Balance
): Promise<AccountCoin> {
  return {
    chain,
    id: tokenId,
    address: await vault.address(chain),
    decimals: balance.decimals,
    ticker: balance.symbol,
  }
}

export type ChainSendLog = {
  chain: Chain
  kind: 'token' | 'native'
  tokenId?: string
  txHash?: string
  skipped?: string
  error?: string
}

/**
 * For one chain: send token balances (minimal amounts), then native if any remains.
 */
export async function sendTokensThenNativeForChain(params: {
  chain: Chain
  sourceVault: VaultBase
  balanceSnapshot: Record<string, Balance>
  receiverForChain: (c: Chain) => Promise<string>
  signBroadcast: SignBroadcastFn
}): Promise<ChainSendLog[]> {
  const logs: ChainSendLog[] = []
  const { chain, sourceVault, balanceSnapshot, receiverForChain, signBroadcast } = params

  const tokenEntries = collectTokenEntries(balanceSnapshot).filter(t => t.chain === chain)

  for (const { tokenId } of tokenEntries) {
    const key = `${chain}:${tokenId}`
    const bal = balanceSnapshot[key]
    if (!bal) continue

    const amount = await resolveTokenSendAmount({ balance: bal })
    if (amount === null) {
      logs.push({ chain, kind: 'token', tokenId, skipped: 'amount below threshold or zero' })
      continue
    }

    let receiver: string
    try {
      receiver = await receiverForChain(chain)
    } catch {
      logs.push({ chain, kind: 'token', tokenId, skipped: 'receiver derivation failed' })
      continue
    }

    const coin = await buildTokenCoin(sourceVault, chain, tokenId, bal)
    try {
      const keysignPayload = await sourceVault.prepareSendTx({ coin, receiver, amount })
      const txHash = await signBroadcast({ vault: sourceVault, chain, keysignPayload })
      logs.push({ chain, kind: 'token', tokenId, txHash })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logs.push({ chain, kind: 'token', tokenId, error: msg })
      throw err
    }
    await sleep(BROADCAST_COOLDOWN_MS)
  }

  const fresh = await sourceVault.balance(chain)
  if (BigInt(fresh.amount) <= 0n) {
    logs.push({ chain, kind: 'native', skipped: 'no native left after tokens' })
    return logs
  }

  let receiver: string
  try {
    receiver = await receiverForChain(chain)
  } catch {
    logs.push({ chain, kind: 'native', skipped: 'receiver derivation failed' })
    return logs
  }

  const coin = await buildNativeCoin(sourceVault, chain)
  const amount = await resolveNativeSendAmount({
    vault: sourceVault,
    chain,
  })
  if (amount === null || amount <= 0n) {
    logs.push({ chain, kind: 'native', skipped: 'minimal amount unavailable or below balance' })
    return logs
  }

  try {
    const keysignPayload = await sourceVault.prepareSendTx({ coin, receiver, amount })
    const txHash = await signBroadcast({ vault: sourceVault, chain, keysignPayload })
    logs.push({ chain, kind: 'native', txHash })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logs.push({ chain, kind: 'native', error: msg })
    throw err
  }

  return logs
}
