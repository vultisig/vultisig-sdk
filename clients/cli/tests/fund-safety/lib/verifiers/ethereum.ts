/**
 * Ethereum on-chain verifier.
 *
 * Ground truth = `eth_getTransactionByHash` on a public node that is NOT
 * the endpoint sdk-cli broadcasts through. A hash present in sdk-cli's
 * output but absent here (or present-but-never-mined) is the
 * silent-broadcast signature (the Ripple #458 class, EVM analogue).
 */
import type { OnChainResult, VerifyOptions } from './types'

const ETH_RPC = 'https://ethereum-rpc.publicnode.com'

type RpcTx = {
  from?: string
  to?: string
  value?: string
  blockNumber?: string | null
  chainId?: string
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) {
    throw new Error(`eth RPC ${method} HTTP ${res.status}`)
  }
  const body = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) {
    throw new Error(`eth RPC ${method} error: ${body.error.message}`)
  }
  return body.result
}

const hexToDec = (hex?: string | null): string | undefined => {
  if (hex == null) return undefined
  try {
    return BigInt(hex).toString(10)
  } catch {
    return undefined
  }
}

/**
 * Polls the public node until the tx is found AND mined (blockNumber
 * non-null), or the timeout elapses. Returns `exists:false` if the node
 * never returns a tx for the hash — that is the silent-broadcast tell.
 */
export async function verifyEthereum(hash: string, opts: VerifyOptions = {}): Promise<OnChainResult> {
  const timeoutSec = opts.timeoutSec ?? 60
  const intervalMs = opts.intervalMs ?? 3000
  const deadline = Date.now() + timeoutSec * 1000

  let lastTx: RpcTx | null = null

  while (Date.now() < deadline) {
    const tx = (await rpcCall('eth_getTransactionByHash', [hash])) as RpcTx | null
    if (tx) {
      lastTx = tx
      // Found in mempool — wait for it to be mined before asserting,
      // so a stuck/replaced tx doesn't read as a clean success.
      if (tx.blockNumber != null) {
        return {
          exists: true,
          fromAddr: tx.from?.toLowerCase(),
          toAddr: tx.to?.toLowerCase(),
          value: hexToDec(tx.value),
          blockNumber: tx.blockNumber ? Number(BigInt(tx.blockNumber)) : undefined,
          chainId: tx.chainId ? Number(BigInt(tx.chainId)) : undefined,
          raw: tx,
        }
      }
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }

  // Timed out. If we never saw the tx at all, this is the silent-broadcast
  // signature: sdk-cli handed us a hash the canonical chain has no record
  // of. If we saw it in mempool but it never mined, surface that too —
  // still a fund-safety concern (the user thinks it's done).
  return {
    exists: false,
    fromAddr: lastTx?.from?.toLowerCase(),
    toAddr: lastTx?.to?.toLowerCase(),
    value: hexToDec(lastTx?.value),
    raw: lastTx ?? { note: 'tx never returned by eth_getTransactionByHash within timeout' },
  }
}
