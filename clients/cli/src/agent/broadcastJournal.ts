/**
 * Local broadcast journal (audit F1/F14 — double-spend window).
 *
 * A tx is signed + broadcast on-chain, and only THEN is the result reported
 * back to the backend (recursive `recent_actions` POST). If that follow-up POST
 * fails, `agent ask` exits non-zero and a naive caller retries in a FRESH
 * process — which re-runs the turn, re-builds the same calldata, and broadcasts
 * the SAME intent a SECOND time. The in-memory `evmLastBroadcast` guard can't
 * catch this: it dies with the process.
 *
 * This journal persists every broadcast to `~/.vultisig/broadcasts.jsonl` so a
 * later process can recognise an intent it (or a sibling process) already
 * broadcast recently and refuse to double-send unless `--force` is passed.
 *
 * Append-only, one JSON object per line. Two record kinds:
 *   - `broadcast`  — an intent fingerprint was signed + broadcast (carries hash)
 *   - `resolved`   — that hash reached a terminal on-chain status
 *
 * A recent broadcast blocks a re-send UNLESS its latest resolution is a
 * definitive failure (`failed`/`error`) — only then is an automatic retry
 * legitimate. `pending`, `confirmed`, `timeout`, or no-resolution all keep the
 * intent guarded (a confirmed tx must not be re-sent; a timeout may still land).
 *
 * Design note: reads FAIL OPEN (a corrupt/unreadable journal never bricks the
 * wallet CLI) and writes are best-effort (a broadcast is never blocked by an
 * inability to record it). The refusal itself is the only hard gate.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { AgentErrorCode } from './agentErrors'

/** Default lookback window for treating a prior broadcast as a live duplicate. */
export const DEFAULT_BROADCAST_WINDOW_MS = 10 * 60 * 1000

/**
 * The minimal, chain-agnostic description of what is about to be broadcast.
 * Fingerprinted so an identical intent produces an identical id across
 * processes. Everything is normalised (lowercased, trimmed) before hashing so
 * cosmetic differences (checksum casing, `0x` calldata casing) don't defeat the
 * match.
 */
export type BroadcastIntent = {
  chain: string
  /**
   * Owner discriminator — the sending vault's public key. The journal is a
   * single global file, so without this two DIFFERENT vaults sending an
   * identical (chain, to, value) tx within the window would collide and the
   * second would be wrongly refused. Namespacing by owner keeps each vault's
   * guard independent.
   */
  owner?: string
  /** Recipient / contract address. */
  to?: string
  /** Native value or token amount, stringified. */
  value?: string
  /** EVM calldata or cosmos/UTXO memo. */
  data?: string
  /**
   * Asset/denom discriminator for non-EVM sends, where the token identity is
   * NOT encoded in `to`/`data` (unlike EVM, whose contract address + calldata
   * already distinguish tokens). Without it, two same-amount sends of different
   * assets to the same address would share a fingerprint.
   */
  asset?: string
}

type BroadcastRecord = { t: 'broadcast'; fp: string; hash: string; chain: string; ts: number }
type ResolutionRecord = { t: 'resolved'; hash: string; status: string; ts: number }
type JournalRecord = BroadcastRecord | ResolutionRecord

/** A terminal status that clears the way for an automatic retry of the intent. */
function isRetryableResolution(status: string): boolean {
  const s = status.toLowerCase()
  return s === 'failed' || s === 'error'
}

/**
 * Refusal thrown when an identical intent was broadcast recently and hasn't
 * definitively failed. Carries the prior hash so a headless caller can inspect
 * the already-broadcast tx instead of blindly resending.
 */
export class DuplicateBroadcastError extends Error {
  readonly code = AgentErrorCode.DUPLICATE_BROADCAST
  readonly priorHash: string
  readonly priorChain: string
  readonly priorTs: number

  constructor(prior: BroadcastRecord) {
    const agoSec = Math.max(0, Math.round((nowMs() - prior.ts) / 1000))
    super(
      `Refusing to broadcast: an identical transaction was already broadcast ${agoSec}s ago on ` +
        `${prior.chain} (tx ${prior.hash}). It has not definitively failed, so re-sending risks a ` +
        `double-spend. Check its status (\`vsig tx-status\`); pass --force to broadcast anyway.`
    )
    this.name = 'DuplicateBroadcastError'
    this.priorHash = prior.hash
    this.priorChain = prior.chain
    this.priorTs = prior.ts
  }
}

function nowMs(): number {
  return Date.now()
}

/**
 * Resolve the journal file path. Precedence:
 *   1. `VULTISIG_BROADCAST_JOURNAL_PATH` — an explicit file path (tests point
 *      this at a temp file so they never touch the real journal).
 *   2. `VULTISIG_CONFIG_DIR/broadcasts.jsonl` — the same config dir the
 *      credential store uses, so all CLI state stays together.
 *   3. `~/.vultisig/broadcasts.jsonl` — the default.
 */
export function journalPath(): string {
  const explicit = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  if (explicit && explicit.trim()) return explicit
  const dir =
    process.env.VULTISIG_CONFIG_DIR && process.env.VULTISIG_CONFIG_DIR.trim()
      ? process.env.VULTISIG_CONFIG_DIR
      : join(homedir(), '.vultisig')
  return join(dir, 'broadcasts.jsonl')
}

function normalize(v: string | undefined): string {
  return (v ?? '').trim().toLowerCase()
}

/** Stable fingerprint for a broadcast intent (sha256 → short hex). */
export function computeFingerprint(intent: BroadcastIntent): string {
  const canonical = [
    normalize(intent.owner),
    normalize(intent.chain),
    normalize(intent.to),
    normalize(intent.value),
    normalize(intent.data),
    normalize(intent.asset),
  ].join('|')
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

function appendRecord(record: JournalRecord): void {
  const path = journalPath()
  try {
    // Owner-only dir (0o700) + file (0o600), mirroring the credential/token
    // store: the journal links a vault's tx hashes to broadcast times, so it
    // must not be world-readable if it (rather than the token store) is the
    // first writer to create ~/.vultisig, or if it's redirected to a shared dir.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    appendFileSync(path, JSON.stringify(record) + '\n', { encoding: 'utf8', mode: 0o600 })
    // appendFileSync's `mode` only applies when it CREATES the file; chmod every
    // write so an already-existing file with looser perms is tightened too.
    try {
      chmodSync(path, 0o600)
    } catch {
      // Non-POSIX FS (e.g. Windows) — best-effort.
    }
  } catch (err) {
    // Best-effort: never let a journal-write failure block/abort a broadcast.
    process.stderr.write(`[broadcast-journal] failed to record ${record.t}: ${(err as Error)?.message ?? err}\n`)
  }
}

function readRecords(): JournalRecord[] {
  const path = journalPath()
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    // Missing/unreadable journal → treat as empty (fail open).
    return []
  }
  const records: JournalRecord[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as JournalRecord
      if (parsed && (parsed.t === 'broadcast' || parsed.t === 'resolved')) records.push(parsed)
    } catch {
      // Skip a corrupt/partial line rather than bricking the whole read.
    }
  }
  return records
}

/** Record that an intent fingerprint was broadcast as `hash` on `chain`. */
export function recordBroadcast(fingerprint: string, hash: string, chain: string): void {
  if (!hash) return
  appendRecord({ t: 'broadcast', fp: fingerprint, hash, chain, ts: nowMs() })
}

/** Record that a previously-broadcast `hash` reached a terminal `status`. */
export function recordResolution(hash: string, status: string): void {
  if (!hash) return
  appendRecord({ t: 'resolved', hash, status, ts: nowMs() })
}

export type DuplicateCheckOptions = {
  /** Bypass the guard entirely (the `--force` escape hatch). */
  force?: boolean
  /** Lookback window in ms; defaults to {@link DEFAULT_BROADCAST_WINDOW_MS}. */
  windowMs?: number
}

/**
 * Return the most recent blocking broadcast for `fingerprint` within the
 * window, or null if none. A broadcast blocks unless its latest resolution is a
 * definitive failure.
 */
export function findRecentDuplicate(fingerprint: string, options: DuplicateCheckOptions = {}): BroadcastRecord | null {
  const windowMs = options.windowMs ?? DEFAULT_BROADCAST_WINDOW_MS
  const cutoff = nowMs() - windowMs
  const records = readRecords()

  // Latest resolution status per hash (last write wins — append-only).
  const latestResolution = new Map<string, string>()
  for (const r of records) {
    if (r.t === 'resolved') latestResolution.set(r.hash, r.status)
  }

  let blocking: BroadcastRecord | null = null
  for (const r of records) {
    if (r.t !== 'broadcast') continue
    if (r.fp !== fingerprint) continue
    if (r.ts < cutoff) continue
    const resolution = latestResolution.get(r.hash)
    if (resolution && isRetryableResolution(resolution)) continue // definitively failed → retry allowed
    if (!blocking || r.ts > blocking.ts) blocking = r
  }
  return blocking
}

/**
 * Throw {@link DuplicateBroadcastError} if `intent` was already broadcast
 * recently and hasn't definitively failed. No-op when `force` is set. Records
 * are never mutated here — the caller records the new broadcast after it
 * succeeds.
 */
export function assertNoRecentDuplicate(intent: BroadcastIntent, options: DuplicateCheckOptions = {}): void {
  if (options.force) return
  const fingerprint = computeFingerprint(intent)
  const prior = findRecentDuplicate(fingerprint, options)
  if (prior) throw new DuplicateBroadcastError(prior)
}
