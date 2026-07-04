/**
 * Broadcast-journal (double-spend guard) unit tests — audit F1/F14.
 *
 * Covers the persistent-journal contract: fingerprint stability/normalisation,
 * the recent-duplicate window, resolution semantics (only a definitive failure
 * clears the guard), the --force bypass, and fail-open robustness against a
 * missing/corrupt journal.
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import {
  assertNoRecentDuplicate,
  type BroadcastIntent,
  computeFingerprint,
  ConcurrentBroadcastError,
  DEFAULT_BROADCAST_WINDOW_MS,
  DuplicateBroadcastError,
  findRecentDuplicate,
  journalPath,
  pruneJournal,
  recordBroadcast,
  recordResolution,
  RESERVATION_STALE_MS,
  reserveBroadcast,
} from '../broadcastJournal'

const INTENT: BroadcastIntent = {
  chain: 'Ethereum',
  to: '0xRecipient',
  value: '1000000000000000000',
  data: '0xDEADBEEF',
}

let home: string
let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  home = mkdtempSync(join(tmpdir(), 'vultisig-journal-'))
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(home, 'broadcasts.jsonl')
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = savedHome
  rmSync(home, { recursive: true, force: true })
})

/** Write a raw journal line with a caller-controlled timestamp. */
function writeBroadcastLine(fp: string, hash: string, chain: string, ts: number): void {
  appendFileSync(journalPath(), JSON.stringify({ t: 'broadcast', fp, hash, chain, ts }) + '\n')
}

describe('computeFingerprint', () => {
  it('is deterministic for identical intents', () => {
    expect(computeFingerprint(INTENT)).toBe(computeFingerprint({ ...INTENT }))
  })

  it('normalises case + whitespace so cosmetic differences still match', () => {
    const a = computeFingerprint({ chain: 'Ethereum', to: '0xABC', value: '1', data: '0xFF' })
    const b = computeFingerprint({ chain: ' ethereum ', to: '0xabc', value: '1', data: '0xff' })
    expect(a).toBe(b)
  })

  it('differs when any field differs', () => {
    const base = computeFingerprint(INTENT)
    expect(computeFingerprint({ ...INTENT, to: '0xOther' })).not.toBe(base)
    expect(computeFingerprint({ ...INTENT, value: '2' })).not.toBe(base)
    expect(computeFingerprint({ ...INTENT, data: '0xbeef' })).not.toBe(base)
    expect(computeFingerprint({ ...INTENT, chain: 'Polygon' })).not.toBe(base)
  })
})

describe('findRecentDuplicate', () => {
  it('returns null when the journal is missing (fail open)', () => {
    expect(findRecentDuplicate(computeFingerprint(INTENT))).toBeNull()
  })

  it('finds a broadcast within the window', () => {
    recordBroadcast(computeFingerprint(INTENT), '0xhash1', 'Ethereum')
    const hit = findRecentDuplicate(computeFingerprint(INTENT))
    expect(hit?.hash).toBe('0xhash1')
  })

  it('ignores a broadcast older than the window', () => {
    const fp = computeFingerprint(INTENT)
    writeBroadcastLine(fp, '0xold', 'Ethereum', Date.now() - 20 * 60 * 1000) // 20 min ago
    expect(findRecentDuplicate(fp, { windowMs: 10 * 60 * 1000 })).toBeNull()
  })

  it('does NOT match a different intent', () => {
    recordBroadcast(computeFingerprint(INTENT), '0xhash1', 'Ethereum')
    expect(findRecentDuplicate(computeFingerprint({ ...INTENT, to: '0xSomeoneElse' }))).toBeNull()
  })

  it('a definitively-failed resolution clears the guard (retry allowed)', () => {
    const fp = computeFingerprint(INTENT)
    recordBroadcast(fp, '0xhashFailed', 'Ethereum')
    recordResolution('0xhashFailed', 'failed')
    expect(findRecentDuplicate(fp)).toBeNull()
  })

  it('a confirmed resolution still blocks (re-send would double-spend)', () => {
    const fp = computeFingerprint(INTENT)
    recordBroadcast(fp, '0xhashOk', 'Ethereum')
    recordResolution('0xhashOk', 'confirmed')
    expect(findRecentDuplicate(fp)?.hash).toBe('0xhashOk')
  })

  it('a timeout resolution still blocks (tx may still land)', () => {
    const fp = computeFingerprint(INTENT)
    recordBroadcast(fp, '0xhashTimeout', 'Ethereum')
    recordResolution('0xhashTimeout', 'timeout')
    expect(findRecentDuplicate(fp)?.hash).toBe('0xhashTimeout')
  })

  it('tolerates corrupt/partial lines (skips them, keeps reading)', () => {
    const fp = computeFingerprint(INTENT)
    writeFileSync(
      journalPath(),
      '{not valid json\n' +
        JSON.stringify({ t: 'broadcast', fp, hash: '0xgood', chain: 'Ethereum', ts: Date.now() }) +
        '\n'
    )
    expect(findRecentDuplicate(fp)?.hash).toBe('0xgood')
  })
})

describe('assertNoRecentDuplicate', () => {
  it('throws DuplicateBroadcastError carrying the prior hash', () => {
    recordBroadcast(computeFingerprint(INTENT), '0xprior', 'Ethereum')
    try {
      assertNoRecentDuplicate(INTENT)
      throw new Error('expected a refusal')
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateBroadcastError)
      expect((err as DuplicateBroadcastError).priorHash).toBe('0xprior')
      expect((err as DuplicateBroadcastError).code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    }
  })

  it('does not throw when force is set (--force bypass)', () => {
    recordBroadcast(computeFingerprint(INTENT), '0xprior', 'Ethereum')
    expect(() => assertNoRecentDuplicate(INTENT, { force: true })).not.toThrow()
  })

  it('does not throw for a fresh intent', () => {
    expect(() => assertNoRecentDuplicate(INTENT)).not.toThrow()
  })
})

describe('reserveBroadcast (atomic cross-process reservation — TOCTOU guard)', () => {
  const FP = computeFingerprint(INTENT)

  /** Replicates the internal lock-file convention for direct manipulation. */
  function lockPath(fp: string): string {
    return join(journalPath() + '.locks', `${fp}.lock`)
  }

  it('two simulated contenders: the second is REFUSED while the first holds it', () => {
    // Contender A wins the reservation (both processes already passed the
    // duplicate check — neither has recorded a hash yet).
    const a = reserveBroadcast(FP)
    // Contender B builds the identical intent → must lose and refuse.
    expect(() => reserveBroadcast(FP)).toThrow(ConcurrentBroadcastError)
    try {
      reserveBroadcast(FP)
      throw new Error('expected a refusal')
    } catch (err) {
      expect((err as ConcurrentBroadcastError).code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    }
    // Once A releases (after it recorded the broadcast), a retry can proceed.
    a.release()
    const c = reserveBroadcast(FP)
    c.release()
  })

  it('a DIFFERENT intent is never blocked by a held reservation', () => {
    const a = reserveBroadcast(FP)
    const other = reserveBroadcast(computeFingerprint({ ...INTENT, to: '0xSomeoneElse' }))
    other.release()
    a.release()
  })

  it('steals a STALE reservation (crashed owner) so retries are not wedged forever', () => {
    reserveBroadcast(FP) // held, but never released — simulate a crash
    // Backdate the lock's mtime past the stale TTL.
    const staleMtimeSec = (Date.now() - RESERVATION_STALE_MS - 60_000) / 1000
    utimesSync(lockPath(FP), staleMtimeSec, staleMtimeSec)
    // A fresh contender now steals it instead of refusing forever.
    const stolen = reserveBroadcast(FP)
    stolen.release()
  })

  it('a FRESH (non-stale) reservation is NOT stolen — the live owner keeps it', () => {
    reserveBroadcast(FP)
    expect(() => reserveBroadcast(FP)).toThrow(ConcurrentBroadcastError)
  })

  it('force bypasses the reservation entirely (no lock, releasable no-op)', () => {
    const held = reserveBroadcast(FP)
    // Even with a live reservation held, --force proceeds and its release is safe.
    const forced = reserveBroadcast(FP, { force: true })
    expect(() => forced.release()).not.toThrow()
    held.release()
  })
})

describe('pruneJournal (bounds append-only growth — item 4)', () => {
  const FP = computeFingerprint(INTENT)

  it('drops records older than the retention horizon but KEEPS everything inside the dedupe window', () => {
    const now = Date.now()
    // A recent broadcast (well inside the 10-min dedupe window) + an ancient one.
    recordBroadcast(FP, '0xrecent', 'Ethereum')
    writeBroadcastLine(FP, '0xancient', 'Ethereum', now - 2 * 60 * 60 * 1000) // 2h ago

    const { pruned } = pruneJournal() // default 60-min retention
    expect(pruned).toBe(1)

    const raw = readFileSync(journalPath(), 'utf8')
    expect(raw).toContain('0xrecent') // still inside the window — never dropped
    expect(raw).not.toContain('0xancient') // strictly outside retention — pruned

    // The in-window broadcast still trips the guard after pruning.
    expect(findRecentDuplicate(FP)?.hash).toBe('0xrecent')
  })

  it('never prunes a record still inside the dedupe window even with a tight retention', () => {
    const now = Date.now()
    // ts is 9 min old — inside the 10-min dedupe window.
    writeBroadcastLine(FP, '0xinwindow', 'Ethereum', now - 9 * 60 * 1000)
    // Retention == the dedupe window: the 9-min-old record must survive.
    const { pruned } = pruneJournal({ retentionMs: DEFAULT_BROADCAST_WINDOW_MS })
    expect(pruned).toBe(0)
    expect(findRecentDuplicate(FP)?.hash).toBe('0xinwindow')
  })

  it('is a no-op on a missing journal', () => {
    rmSync(journalPath(), { force: true })
    expect(() => pruneJournal()).not.toThrow()
    expect(pruneJournal()).toEqual({ kept: 0, pruned: 0 })
  })

  it('keeps unparseable lines (a concurrent partial append must never be dropped)', () => {
    const now = Date.now()
    writeBroadcastLine(FP, '0xancient', 'Ethereum', now - 2 * 60 * 60 * 1000)
    appendFileSync(journalPath(), '{partial-concurrent-write\n')
    recordBroadcast(FP, '0xrecent', 'Ethereum')

    pruneJournal()
    const raw = readFileSync(journalPath(), 'utf8')
    expect(raw).toContain('{partial-concurrent-write') // preserved
    expect(raw).toContain('0xrecent')
    expect(raw).not.toContain('0xancient')
  })

  it('SKIPS (never clobbers) when another writer holds the journal lock', () => {
    // The clobber hazard: a prune that rewrites+renames while a sibling process
    // is mid-append would drop that append. The exclusive journal lock closes it
    // — a prune that can't take the lock skips rather than rewriting a snapshot
    // that's about to be stale. Simulate a live lock held by another writer.
    const now = Date.now()
    recordBroadcast(FP, '0xrecent', 'Ethereum')
    writeBroadcastLine(FP, '0xancient', 'Ethereum', now - 2 * 60 * 60 * 1000)
    const lock = journalPath() + '.wlock'
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: now })) // fresh (not stale) → not stolen
    try {
      expect(pruneJournal()).toEqual({ kept: 0, pruned: 0 }) // skipped, not rewritten
      // The journal is untouched — no record was dropped by a clobbering rewrite.
      const raw = readFileSync(journalPath(), 'utf8')
      expect(raw).toContain('0xrecent')
      expect(raw).toContain('0xancient')
    } finally {
      rmSync(lock, { force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Review hardening (CodeRabbit round): record-shape validation, resolution
// timestamp scoping, and CAS-safe stale-lock stealing.
// ---------------------------------------------------------------------------
describe('readRecords shape validation (malformed lines are skipped, not half-parsed)', () => {
  it('ignores a resolved line with a non-string status', () => {
    const fp = computeFingerprint(INTENT)
    writeBroadcastLine(fp, '0xhash1', 'Polygon', Date.now())
    // Structurally invalid resolution: status is an object. Must NOT be
    // treated as a resolution at all — the broadcast stays blocking.
    appendFileSync(journalPath(), JSON.stringify({ t: 'resolved', hash: '0xhash1', status: { s: 'failed' }, ts: Date.now() }) + '\n')
    expect(findRecentDuplicate(fp)).not.toBeNull()
  })

  it('ignores a truncated broadcast line missing its fingerprint', () => {
    appendFileSync(journalPath(), JSON.stringify({ t: 'broadcast', hash: '0xhash2', chain: 'Polygon', ts: Date.now() }) + '\n')
    // A valid broadcast for a DIFFERENT intent — the malformed line must not
    // block anything (it has no fp to match).
    expect(findRecentDuplicate(computeFingerprint(INTENT))).toBeNull()
  })

  it('ignores records with a non-numeric ts', () => {
    const fp = computeFingerprint(INTENT)
    appendFileSync(journalPath(), JSON.stringify({ t: 'broadcast', fp, hash: '0xhash3', chain: 'Polygon', ts: 'now' }) + '\n')
    expect(findRecentDuplicate(fp)).toBeNull()
  })
})

describe('resolution timestamp scoping (an old failure cannot unblock a newer same-hash broadcast)', () => {
  it('a failed resolution BEFORE a re-broadcast of the same hash does not unblock it', () => {
    const fp = computeFingerprint(INTENT)
    const t0 = Date.now() - 60_000
    // attempt 1: broadcast + definitive failure (retry legitimately allowed)
    writeBroadcastLine(fp, '0xsamehash', 'Polygon', t0)
    appendFileSync(journalPath(), JSON.stringify({ t: 'resolved', hash: '0xsamehash', status: 'failed', ts: t0 + 1_000 }) + '\n')
    // attempt 2 (e.g. --force): same hash re-broadcast AFTER the failure.
    writeBroadcastLine(fp, '0xsamehash', 'Polygon', t0 + 10_000)
    // The old failure must not retroactively mark attempt 2 as failed.
    const blocking = findRecentDuplicate(fp)
    expect(blocking).not.toBeNull()
    expect(blocking!.ts).toBe(t0 + 10_000)
  })

  it('a failed resolution AFTER the broadcast still unblocks it', () => {
    const fp = computeFingerprint(INTENT)
    const t0 = Date.now() - 60_000
    writeBroadcastLine(fp, '0xfailedhash', 'Polygon', t0)
    appendFileSync(journalPath(), JSON.stringify({ t: 'resolved', hash: '0xfailedhash', status: 'failed', ts: t0 + 1_000 }) + '\n')
    expect(findRecentDuplicate(fp)).toBeNull()
  })
})

describe('stale-lock steal is rename-based (CAS-safe)', () => {
  it('steals a genuinely stale journal lock, appends, and leaves no residue', () => {
    const lockPath = journalPath() + '.wlock'
    mkdirSync(dirname(lockPath), { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: 99999, ts: 0 }))
    // Age the lock file well past the stale TTL so the writer must steal it.
    const old = Date.now() / 1000 - 3600
    utimesSync(lockPath, old, old)
    const fp = computeFingerprint(INTENT)
    recordBroadcast(fp, '0xstealhash', 'Polygon')
    // The broadcast was recorded (steal succeeded, no deadlock)...
    expect(findRecentDuplicate(fp)).not.toBeNull()
    // ...the stolen lock was released, and no rename residue remains.
    const residue = readdirSync(dirname(lockPath)).filter((f) => f.includes('.stale.'))
    expect(residue).toEqual([])
    expect(existsSync(lockPath)).toBe(false)
  })

  it('leaves a FRESH lock untouched (concurrent holder keeps it; append still lands)', () => {
    const lockPath = journalPath() + '.wlock'
    mkdirSync(dirname(lockPath), { recursive: true })
    const content = JSON.stringify({ pid: process.pid, ts: Date.now() })
    writeFileSync(lockPath, content)
    const fp = computeFingerprint(INTENT)
    recordBroadcast(fp, '0xfreshhash', 'Polygon')
    // append-after-timeout still records (never DROP a broadcast record)...
    expect(findRecentDuplicate(fp)).not.toBeNull()
    // ...but the live holder's lock file was neither stolen nor renamed.
    expect(existsSync(lockPath)).toBe(true)
    expect(readFileSync(lockPath, 'utf8')).toBe(content)
    rmSync(lockPath, { force: true })
  })
})
