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
import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { AgentErrorCode } from './agentErrors'

/** Default lookback window for treating a prior broadcast as a live duplicate. */
export const DEFAULT_BROADCAST_WINDOW_MS = 10 * 60 * 1000

/**
 * How long an in-flight reservation (see {@link reserveBroadcast}) is honoured
 * before it's treated as abandoned by a crashed process and stolen. Must
 * comfortably exceed the worst-case legitimate sign+broadcast duration — the
 * slowest path is a multi-leg approve whose receipt-wait alone budgets 90s —
 * so a genuinely-still-working process is never stolen from. 5 min gives ample
 * headroom while still unwedging retries reasonably fast after a real crash.
 */
export const RESERVATION_STALE_MS = 5 * 60 * 1000

/**
 * Retention horizon for on-write journal pruning. A record older than this is
 * strictly irrelevant to the dedupe check (its ts is far outside the 10-min
 * {@link DEFAULT_BROADCAST_WINDOW_MS} lookback, and a resolution's ts is always
 * ≥ its broadcast's, so no in-window broadcast can depend on a pruned record).
 * window × 6 = 60 min: generous slack over the window so clock jitter or a
 * long-lived process can never prune a still-live record.
 */
export const PRUNE_RETENTION_MS = DEFAULT_BROADCAST_WINDOW_MS * 6

/**
 * Only compact the journal once it crosses this on-disk size. Keeps the write
 * path a single cheap `statSync` in the common (small-journal) case and bounds
 * how large `broadcasts.jsonl` can grow before a rewrite reclaims it.
 */
export const PRUNE_TRIGGER_BYTES = 128 * 1024

/**
 * Stale TTL for the journal read-modify-write lock (see {@link acquireJournalLock}).
 * A compaction or an append is sub-second, so a lock older than this is a crashed
 * holder and is stolen.
 */
export const JOURNAL_LOCK_STALE_MS = 30 * 1000

/** Max time an append will wait for the compaction lock before proceeding unlocked. */
const APPEND_LOCK_WAIT_MS = 2000
/** Max time a prune will wait for the lock before skipping this round. */
const PRUNE_LOCK_WAIT_MS = 500

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

type BroadcastRecord = {
  t: 'broadcast'
  fp: string
  hash: string
  chain: string
  ts: number
}
type ResolutionRecord = {
  t: 'resolved'
  hash: string
  status: string
  ts: number
}
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

/**
 * Refusal thrown when a SIBLING PROCESS currently holds the atomic reservation
 * for this intent (see {@link reserveBroadcast}) — it has passed the duplicate
 * check and is mid sign+broadcast but hasn't recorded a hash yet, so there's no
 * prior hash to report. Shares the {@link AgentErrorCode.DUPLICATE_BROADCAST}
 * code (and thus exit code) with {@link DuplicateBroadcastError}: from the
 * loser's perspective both mean "an identical broadcast is already in play,
 * don't send". Closes the check-then-record TOCTOU window that the journal's
 * committed-record guard alone cannot.
 */
export class ConcurrentBroadcastError extends Error {
  readonly code = AgentErrorCode.DUPLICATE_BROADCAST

  constructor() {
    super(
      'Refusing to broadcast: another process is concurrently signing an identical transaction ' +
        '(it holds the broadcast reservation). Re-sending now risks a double-spend. Wait for it to ' +
        'finish and check the result; pass --force to broadcast anyway.'
    )
    this.name = 'ConcurrentBroadcastError'
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

/** Exclusive lock guarding journal read-modify-write (append vs compaction). */
function journalLockPath(): string {
  return journalPath() + '.wlock'
}

/** Synchronous sleep (bounded) — used only while spinning for the journal lock. */
function sleepSyncMs(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // SharedArrayBuffer unavailable — cheap busy spin, still bounded by ms.
    const end = nowMs() + ms
    while (nowMs() < end) {
      /* spin */
    }
  }
}

/**
 * Acquire an exclusive lock serializing journal writes with the compactor. This
 * is what makes {@link pruneJournal}'s read→rewrite→rename safe: without it, an
 * append landing between the compactor's read and its rename would be dropped
 * (the rename swaps in a snapshot taken before the append), silently losing a
 * broadcast record and un-guarding that intent. Returns a release fn, or null if
 * the lock couldn't be taken within `maxWaitMs` (caller decides how to degrade).
 * A lock older than {@link JOURNAL_LOCK_STALE_MS} is stolen (crashed holder).
 * Best-effort: an FS that can't create the lock returns null (proceed unlocked).
 */
/**
 * CAS-safe steal of a stale lock file. Unlink-then-create lets two contenders
 * interleave (A unlinks, A creates, B unlinks A's FRESH lock, B creates → both
 * "hold" the lock). rename(2) is atomic — exactly one contender's rename of the
 * stale path succeeds; the loser gets ENOENT and retries the exclusive create,
 * where it sees the winner's fresh lock.
 *
 * Returns 'held' when what we renamed turned out to be FRESH (a contender
 * recreated the lock between the caller's stat and our rename) — the lock is
 * restored to its live holder and the caller must wait. Returns 'stolen' when
 * the stale lock is gone and the caller should retry the create.
 */
function stealStaleLock(path: string): 'stolen' | 'held' {
  const stolen = `${path}.stale.${process.pid}.${Math.random().toString(36).slice(2, 8)}`
  try {
    renameSync(path, stolen)
  } catch {
    return 'stolen' // lost the steal race (or lock vanished) — retry create
  }
  try {
    if (nowMs() - statSync(stolen).mtimeMs <= JOURNAL_LOCK_STALE_MS) {
      try {
        renameSync(stolen, path)
      } catch {
        // restore failed (holder released meanwhile) — nothing left to hold
      }
      return 'held'
    }
  } catch {
    return 'stolen' // stolen file vanished — nothing to verify
  }
  try {
    rmSync(stolen, { force: true })
  } catch {
    // best-effort residue cleanup
  }
  return 'stolen'
}

function acquireJournalLock(maxWaitMs: number): (() => void) | null {
  const path = journalLockPath()
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  } catch {
    return null
  }
  const deadline = nowMs() + maxWaitMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx', 0o600)
      try {
        writeSync(fd, JSON.stringify({ pid: process.pid, ts: nowMs() }))
      } catch {
        // content is debug-only; the lock's existence is what matters
      } finally {
        closeSync(fd)
      }
      return () => {
        try {
          rmSync(path, { force: true })
        } catch {
          // best-effort; the stale-TTL sweep reclaims a lock we can't unlink
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return null
      let stale = false
      try {
        stale = nowMs() - statSync(path).mtimeMs > JOURNAL_LOCK_STALE_MS
      } catch {
        continue // vanished between EEXIST and stat — retry the create
      }
      if (stale && stealStaleLock(path) === 'stolen') {
        continue // stale lock cleared — retry the exclusive create
      }
      // Lock is held by a live process (fresh, or restored mid-steal) — wait.
      if (nowMs() >= deadline) return null
      sleepSyncMs(10)
    }
  }
}

function appendRecord(record: JournalRecord): void {
  const path = journalPath()
  try {
    // Owner-only dir (0o700) + file (0o600), mirroring the credential/token
    // store: the journal links a vault's tx hashes to broadcast times, so it
    // must not be world-readable if it (rather than the token store) is the
    // first writer to create ~/.vultisig, or if it's redirected to a shared dir.
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    // Serialize the append with a concurrent compaction so a prune's rewrite
    // can't clobber it (a lost broadcast record un-guards its intent — a
    // double-spend hazard). The wait runs AFTER the broadcast, so a brief pause
    // is harmless; if the lock is stuck we STILL append (never DROP a broadcast
    // record — recording is the fund-safety-critical half).
    const releaseLock = acquireJournalLock(APPEND_LOCK_WAIT_MS)
    try {
      appendFileSync(path, JSON.stringify(record) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
      })
      // appendFileSync's `mode` only applies when it CREATES the file; chmod every
      // write so an already-existing file with looser perms is tightened too.
      try {
        chmodSync(path, 0o600)
      } catch {
        // Non-POSIX FS (e.g. Windows) — best-effort.
      }
    } finally {
      releaseLock?.()
    }
    // Prune-on-write: bound the append-only journal so a later sign doesn't
    // parse an ever-growing file. Size-gated so the common path is one statSync.
    // Runs AFTER releasing the lock above — pruneJournal re-acquires it itself.
    maybePruneJournal(path)
  } catch (err) {
    // Best-effort: never let a journal-write failure block/abort a broadcast.
    process.stderr.write(`[broadcast-journal] failed to record ${record.t}: ${(err as Error)?.message ?? err}\n`)
  }
}

/** Structural validation for a parsed journal line — see readRecords. */
function isValidRecord(r: unknown): r is JournalRecord {
  if (r === null || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return false
  if (o.t === 'broadcast') {
    return (
      typeof o.fp === 'string' &&
      o.fp.length > 0 &&
      typeof o.hash === 'string' &&
      o.hash.length > 0 &&
      typeof o.chain === 'string'
    )
  }
  if (o.t === 'resolved') {
    return typeof o.hash === 'string' && o.hash.length > 0 && typeof o.status === 'string' && o.status.length > 0
  }
  return false
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
      // Shape-validate before accepting: a structurally-wrong line (e.g. a
      // `resolved` with a non-string status, or a truncated `broadcast`
      // missing its fp) must be SKIPPED like a corrupt line, not half-parsed
      // into the guard's decision inputs.
      if (isValidRecord(parsed)) records.push(parsed)
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

  // Latest resolution per hash (last write wins — append-only). The timestamp
  // is kept so a resolution can only be applied to broadcasts that happened
  // BEFORE it: a `--force` re-broadcast can reuse the same hash, and an OLD
  // "failed" resolution from the prior attempt must not retroactively unblock
  // the newer broadcast (that would let a third identical send through).
  const latestResolution = new Map<string, { status: string; ts: number }>()
  for (const r of records) {
    if (r.t === 'resolved') latestResolution.set(r.hash, { status: r.status, ts: r.ts })
  }

  let blocking: BroadcastRecord | null = null
  for (const r of records) {
    if (r.t !== 'broadcast') continue
    if (r.fp !== fingerprint) continue
    if (r.ts < cutoff) continue
    const resolution = latestResolution.get(r.hash)
    // definitively failed AFTER this broadcast → retry allowed
    if (resolution && resolution.ts >= r.ts && isRetryableResolution(resolution.status)) continue
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

// ============================================================================
// Atomic cross-process reservation (closes the check-then-record TOCTOU)
// ============================================================================

/** A held reservation; call {@link BroadcastReservation.release} once done. */
export type BroadcastReservation = { release: () => void }

/** Directory holding one lock file per in-flight broadcast fingerprint. */
function reservationDir(): string {
  return journalPath() + '.locks'
}

function reservationPath(fingerprint: string): string {
  return join(reservationDir(), `${fingerprint}.lock`)
}

/**
 * A reservation lock is stale once its file mtime is older than
 * {@link RESERVATION_STALE_MS} — the owning process either crashed or wedged.
 * mtime (not the file's recorded ts) is used deliberately: it's set atomically
 * at create time by the OS, so a lock observed between exclusive-create and its
 * content write is never mis-read as stale.
 *
 * A vanished file (owner released in the instant between the caller's EEXIST and
 * this stat) returns `false` → NOT stale → {@link reserveBroadcast} refuses with
 * ConcurrentBroadcastError rather than stealing/retrying. That is the
 * FUND-SAFE choice, not a retry: the loser already passed
 * {@link assertNoRecentDuplicate} before the winner recorded its hash, so
 * re-acquiring here would reopen the exact double-spend window the reservation
 * exists to close. The caller simply re-runs the whole guard on its next attempt.
 */
function isStaleReservation(path: string): boolean {
  try {
    return nowMs() - statSync(path).mtimeMs > RESERVATION_STALE_MS
  } catch {
    return false
  }
}

function releaseReservation(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // Best-effort: the stale-TTL sweep reclaims a lock we somehow can't unlink.
  }
}

/**
 * Atomically reserve the exclusive right to sign+broadcast `fingerprint` before
 * signing. Two sibling processes can BOTH pass {@link assertNoRecentDuplicate}
 * (neither has recorded a hash yet), then both broadcast — the classic
 * check-then-record TOCTOU. An exclusive-create (`wx`) lock file keyed by the
 * fingerprint lets exactly one win; the loser gets {@link ConcurrentBroadcastError}
 * and must refuse. The winner releases after it has recorded the broadcast, at
 * which point the durable journal record takes over as the guard.
 *
 * A lock whose mtime is older than {@link RESERVATION_STALE_MS} is treated as
 * abandoned (crashed owner) and stolen so retries aren't wedged forever.
 *
 * No-op when `force` is set (the `--force` escape hatch). Best-effort on the
 * reservation LAYER only: if the lock dir/file can't be created (perms, exotic
 * FS) we proceed WITHOUT the extra concurrency guard rather than brick a
 * broadcast — the journal check+record still guards committed broadcasts.
 */
export function reserveBroadcast(fingerprint: string, options: DuplicateCheckOptions = {}): BroadcastReservation {
  const noop: BroadcastReservation = { release: () => {} }
  if (options.force) return noop

  const path = reservationPath(fingerprint)
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  } catch {
    return noop // can't even make the lock dir → skip the reservation layer
  }

  // At most two attempts: acquire, or (on EEXIST-but-stale) steal once.
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number
    try {
      fd = openSync(path, 'wx', 0o600)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') return noop // FS/perms → fail open
      if (isStaleReservation(path)) {
        releaseReservation(path) // crashed owner — steal and retry the create
        continue
      }
      throw new ConcurrentBroadcastError() // a live sibling holds it → loser refuses
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, ts: nowMs() }))
    } catch {
      // Content is debug-only; the lock's existence (+ mtime) is what matters.
    } finally {
      closeSync(fd)
    }
    return { release: () => releaseReservation(path) }
  }
  // Lost the steal race to another contender within the same instant.
  throw new ConcurrentBroadcastError()
}

// ============================================================================
// On-write pruning (bounds the append-only journal's growth)
// ============================================================================

/**
 * Compact the journal in place, dropping every record older than
 * `retentionMs` (default {@link PRUNE_RETENTION_MS}). Kept records: anything
 * whose ts is within retention, PLUS any line we can't parse (which may be a
 * concurrent in-flight append — never drop it). Corrupt/old lines are the only
 * thing removed. Writes to a temp file then atomically renames, so a reader
 * never sees a half-written journal.
 *
 * The read→rewrite→rename runs UNDER the exclusive journal lock (which
 * {@link appendRecord} also takes), so a concurrent append is never clobbered:
 * it either landed before this read (and is preserved) or blocks until the
 * rename completes (and appends to the new file). If the lock can't be taken
 * (another writer holds it) the prune is skipped this round — correctness over
 * compaction; the next append retries. Best-effort and self-contained; a
 * failure leaves the original journal untouched. Returns the kept/pruned counts.
 */
export function pruneJournal(options: { retentionMs?: number } = {}): {
  kept: number
  pruned: number
} {
  const retentionMs = options.retentionMs ?? PRUNE_RETENTION_MS
  const path = journalPath()
  const cutoff = nowMs() - retentionMs

  // Hold the lock across the ENTIRE read→rename so no append interleaves.
  const releaseLock = acquireJournalLock(PRUNE_LOCK_WAIT_MS)
  if (!releaseLock) return { kept: 0, pruned: 0 } // a writer holds it — skip, retry next append
  try {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      return { kept: 0, pruned: 0 } // nothing to prune
    }

    const kept: string[] = []
    let pruned = 0
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let ts: number | undefined
      try {
        const rec = JSON.parse(line) as Partial<JournalRecord>
        ts = typeof rec?.ts === 'number' ? rec.ts : undefined
      } catch {
        // Unparseable — could be a concurrent partial append; keep it to be safe.
        kept.push(line)
        continue
      }
      if (ts !== undefined && ts < cutoff) {
        pruned++ // strictly outside the dedupe window — safe to drop
        continue
      }
      kept.push(line)
    }

    if (pruned === 0) return { kept: kept.length, pruned: 0 }

    const tmp = `${path}.prune.${process.pid}.tmp`
    try {
      writeFileSync(tmp, kept.length ? kept.join('\n') + '\n' : '', {
        encoding: 'utf8',
        mode: 0o600,
      })
      renameSync(tmp, path)
      try {
        chmodSync(path, 0o600)
      } catch {
        // Non-POSIX FS — best-effort.
      }
    } catch (err) {
      try {
        rmSync(tmp, { force: true })
      } catch {
        // leave it; a later prune overwrites the same-pid temp name
      }
      if (process.env.VULTISIG_DEBUG)
        process.stderr.write(`[broadcast-journal] prune skipped: ${(err as Error)?.message ?? err}\n`)
      return { kept: 0, pruned: 0 }
    }
    return { kept: kept.length, pruned }
  } finally {
    releaseLock()
  }
}

/** Size-gated prune for the write path: read+rewrite only once the file is large. */
function maybePruneJournal(path: string): void {
  try {
    if (statSync(path).size <= PRUNE_TRIGGER_BYTES) return
  } catch {
    return // no file / can't stat → nothing to prune
  }
  pruneJournal()
}
