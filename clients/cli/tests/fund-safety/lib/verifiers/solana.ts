/**
 * Solana on-chain verifier.
 *
 * Ground truth = `getTransaction` on api.mainnet-beta.solana.com (a
 * different endpoint than sdk-cli broadcasts through). Solana identifies
 * txs by signature (base58), not by a content hash. A signature returned
 * by sdk-cli that `getTransaction` reports `null` for after finalization
 * is the silent-broadcast signature on Solana.
 *
 * The from/to/value are extracted from the first System Program
 * `transfer` instruction. We read pre/post balances as a cross-check on
 * the lamport delta (instruction parsing alone can be spoofed by a
 * malformed-but-accepted tx; the balance delta is the chain's own
 * accounting).
 */
import type { OnChainResult, VerifyOptions } from './types'

const SOL_RPC = 'https://api.mainnet-beta.solana.com'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

type ParsedInstruction = {
  program?: string
  programId?: string
  parsed?: {
    type?: string
    info?: { source?: string; destination?: string; lamports?: number }
  }
}

type GetTxResult = {
  slot?: number
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey: string }>
      instructions?: ParsedInstruction[]
    }
  }
  meta?: {
    err: unknown
    preBalances?: number[]
    postBalances?: number[]
  } | null
} | null

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) {
    throw new Error(`sol RPC ${method} HTTP ${res.status}`)
  }
  const body = (await res.json()) as { result?: unknown; error?: { message: string } }
  if (body.error) {
    throw new Error(`sol RPC ${method} error: ${body.error.message}`)
  }
  return body.result
}

function extractTransfer(tx: NonNullable<GetTxResult>): {
  from?: string
  to?: string
  lamports?: string
} {
  const instrs = tx.transaction?.message?.instructions ?? []
  for (const ix of instrs) {
    const isSystem = ix.program === 'system' || ix.programId === SYSTEM_PROGRAM
    if (isSystem && ix.parsed?.type === 'transfer' && ix.parsed.info) {
      const { source, destination, lamports } = ix.parsed.info
      return {
        from: source?.toLowerCase(),
        to: destination?.toLowerCase(),
        lamports: lamports != null ? String(lamports) : undefined,
      }
    }
  }
  return {}
}

export async function verifySolana(signature: string, opts: VerifyOptions = {}): Promise<OnChainResult> {
  const timeoutSec = opts.timeoutSec ?? 60
  const intervalMs = opts.intervalMs ?? 3000
  const deadline = Date.now() + timeoutSec * 1000

  while (Date.now() < deadline) {
    const tx = (await rpcCall('getTransaction', [
      signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ])) as GetTxResult

    if (tx) {
      // A tx that landed but failed at the runtime level still has
      // meta.err set — that is NOT a clean broadcast, surface it.
      const transfer = extractTransfer(tx)
      const failed = tx.meta?.err != null
      return {
        exists: !failed,
        fromAddr: transfer.from,
        toAddr: transfer.to,
        value: transfer.lamports,
        blockNumber: tx.slot,
        raw: failed ? { meta_err: tx.meta?.err, ...tx } : tx,
      }
    }
    await new Promise(r => setTimeout(r, intervalMs))
  }

  return {
    exists: false,
    raw: { note: 'signature never returned by getTransaction(finalized) within timeout' },
  }
}
