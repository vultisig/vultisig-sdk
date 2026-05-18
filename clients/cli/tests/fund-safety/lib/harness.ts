/**
 * Fund-safety regression harness.
 *
 * Drives `vsig agent ask "send …"` end-to-end against a REAL funded
 * vault on mainnet, captures the broadcast identifier sdk-cli reports,
 * then independently verifies it landed on-chain via a public RPC that
 * is NOT sdk-cli's broadcast downstream. The mismatch case
 * (hash returned, chain has no record) is the silent-broadcast bug
 * class — see vultisig-sdk #458 (Ripple `temREDUNDANT`).
 *
 * SAFETY: every test that calls `captureBroadcast` MUST first guard on
 * `shouldRunE2E()`. With `FUND_SAFETY_E2E` unset the suite performs
 * zero broadcasts (verified by the skip-gate test).
 */
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { verifyEthereum } from './verifiers/ethereum'
import { verifySolana } from './verifiers/solana'
import type { OnChainResult, VerifyOptions } from './verifiers/types'

export type Chain = 'ethereum' | 'solana'

const CLI = resolve(__dirname, '../../../dist/index.js')
const LAST_RUN_DIR = resolve(__dirname, '../last-run')

/**
 * The single safety gate. NOTHING in this suite may broadcast unless
 * this returns true. Tests call it in a `describe.skipIf`/early-return.
 */
export function shouldRunE2E(): boolean {
  return process.env.FUND_SAFETY_E2E === '1' || process.env.FUND_SAFETY_E2E === 'true'
}

/** Vault + password the harness drives. Canonical test wallet by default. */
export function vaultConfig(): { vault: string; password: string; backendUrl?: string } {
  return {
    // `Vultisig Cluster #1` → 0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35
    vault: process.env.FUND_SAFETY_VAULT ?? 'Vultisig Cluster #1',
    password: process.env.FUND_SAFETY_PASSWORD ?? 'password',
    // Defaults to prod abe.vultisig.com inside the CLI when unset. The
    // suite deliberately exercises the real signing+broadcast path.
    backendUrl: process.env.FUND_SAFETY_BACKEND_URL,
  }
}

type ExecResult = { stdout: string; stderr: string; code: number }

function runVsig(args: string[], timeoutMs: number): Promise<ExecResult> {
  return new Promise(res => {
    execFile('node', [CLI, ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      res({ stdout, stderr, code: (err as { code?: number } | null)?.code ?? 0 })
    })
  })
}

/**
 * Extract the structured JSON object from CLI stdout. The signing flow
 * may emit log lines before the JSON; the agent-ask JSON envelope is
 * the last top-level `{ … }` block (mirrors tests/e2e/cli-commands).
 */
function parseAgentJson(result: ExecResult): {
  session_id?: string
  response?: string
  tool_calls?: Array<{ action: string; success: boolean; data?: Record<string, unknown>; error?: string }>
  transactions?: Array<{ hash: string; chain: string; explorerUrl?: string }>
} | null {
  const text = result.stdout.trim()
  if (!text) return null
  // outputJson wraps in { success, v, data }. Find the last balanced
  // top-level object.
  const lastBrace = text.lastIndexOf('\n{')
  const candidate = lastBrace >= 0 ? text.slice(lastBrace + 1) : text
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch {
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
  }
  const env = parsed as { success?: boolean; data?: unknown }
  if (env && typeof env === 'object' && 'data' in env) {
    return env.data as ReturnType<typeof parseAgentJson>
  }
  return parsed as ReturnType<typeof parseAgentJson>
}

export type BroadcastCapture = {
  chain: Chain
  /** sdk-cli-reported broadcast id: EVM tx hash / Solana signature. */
  hash: string | null
  /** Raw agent-ask response text (for forensics). */
  response: string
  /** All tool calls the agent emitted. */
  toolCalls: Array<{ action: string; success: boolean; data?: Record<string, unknown>; error?: string }>
  /** All transactions sdk-cli claims it broadcast. */
  transactions: Array<{ hash: string; chain: string; explorerUrl?: string }>
  /** stdout + stderr, kept for the artifact. */
  rawStdout: string
  rawStderr: string
  exitCode: number
}

/**
 * Drives one `vsig agent ask` send and captures what sdk-cli claims it
 * broadcast. Does NOT verify on-chain — that's `verifyOnChain`.
 *
 * Throws only on harness misuse (e.g. called without the E2E gate).
 * A failed/empty broadcast is returned as `hash: null` so the test can
 * assert on it rather than crashing.
 */
export async function captureBroadcast(chain: Chain, prompt: string, timeoutMs = 180_000): Promise<BroadcastCapture> {
  if (!shouldRunE2E()) {
    throw new Error('captureBroadcast called without FUND_SAFETY_E2E — skip-gate breach')
  }
  const cfg = vaultConfig()
  const args = [
    '--output',
    'json',
    '--non-interactive',
    'agent',
    'ask',
    prompt,
    '--vault',
    cfg.vault,
    '--password',
    cfg.password,
  ]
  if (cfg.backendUrl) args.push('--backend-url', cfg.backendUrl)

  const result = await runVsig(args, timeoutMs)
  const json = parseAgentJson(result)

  const transactions = json?.transactions ?? []
  const onChainTx = transactions.find(t => t.chain.toLowerCase().includes(chain === 'ethereum' ? 'eth' : 'sol'))

  return {
    chain,
    hash: onChainTx?.hash ?? transactions[0]?.hash ?? null,
    response: json?.response ?? '',
    toolCalls: json?.tool_calls ?? [],
    transactions,
    rawStdout: result.stdout,
    rawStderr: result.stderr,
    exitCode: result.code,
  }
}

export async function verifyOnChain(chain: Chain, hash: string, opts?: VerifyOptions): Promise<OnChainResult> {
  switch (chain) {
    case 'ethereum':
      return verifyEthereum(hash, opts)
    case 'solana':
      return verifySolana(hash, opts)
    default:
      throw new Error(`no verifier for chain ${chain as string}`)
  }
}

export type MatchExpectation = {
  /** Lowercase expected sender. */
  fromAddr?: string
  /** Lowercase expected recipient. */
  toAddr?: string
  /** Exact native-unit value (wei / lamports) as a decimal string. */
  value?: string
  /** EVM chain id. */
  chainId?: number
}

export class SilentBroadcastError extends Error {
  constructor(
    message: string,
    readonly capture: BroadcastCapture,
    readonly onChain: OnChainResult
  ) {
    super(message)
    this.name = 'SilentBroadcastError'
  }
}

/**
 * The core assertion. Throws `SilentBroadcastError` when sdk-cli
 * reported a hash but the independent RPC has no landed record of it —
 * the exact failure mode of the Ripple #458 bug. Also throws on
 * from/to/value/chainId mismatch (the cross-chain / wrong-amount
 * classes).
 */
export function assertBroadcastMatches(
  capture: BroadcastCapture,
  onChain: OnChainResult,
  expected: MatchExpectation
): void {
  if (!capture.hash) {
    throw new SilentBroadcastError(
      `sdk-cli returned no broadcast hash. response="${capture.response.slice(0, 200)}"`,
      capture,
      onChain
    )
  }
  if (!onChain.exists) {
    throw new SilentBroadcastError(
      `SILENT BROADCAST: sdk-cli reported hash ${capture.hash} but the independent ` +
        `RPC has no landed record of it. This is the #458 bug class.`,
      capture,
      onChain
    )
  }
  const mismatches: string[] = []
  if (expected.fromAddr && onChain.fromAddr && onChain.fromAddr !== expected.fromAddr) {
    mismatches.push(`from: on-chain=${onChain.fromAddr} expected=${expected.fromAddr}`)
  }
  if (expected.toAddr && onChain.toAddr && onChain.toAddr !== expected.toAddr) {
    mismatches.push(`to: on-chain=${onChain.toAddr} expected=${expected.toAddr}`)
  }
  if (expected.value && onChain.value && onChain.value !== expected.value) {
    mismatches.push(`value: on-chain=${onChain.value} expected=${expected.value}`)
  }
  if (expected.chainId != null && onChain.chainId != null && onChain.chainId !== expected.chainId) {
    mismatches.push(`chainId: on-chain=${onChain.chainId} expected=${expected.chainId}`)
  }
  if (mismatches.length > 0) {
    throw new SilentBroadcastError(
      `Broadcast landed but does NOT match intent:\n  ${mismatches.join('\n  ')}`,
      capture,
      onChain
    )
  }
}

/** Forensic artifact written under last-run/ for post-mortem inspection. */
export function writeArtifact(name: string, data: unknown): void {
  try {
    mkdirSync(LAST_RUN_DIR, { recursive: true })
    writeFileSync(resolve(LAST_RUN_DIR, `${name}.json`), JSON.stringify(data, null, 2))
  } catch {
    // Artifact writing is best-effort; never fail a test on it.
  }
}
