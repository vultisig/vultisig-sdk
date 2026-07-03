/**
 * Broadcast-journal (double-spend guard) unit tests — audit F1/F14.
 *
 * Covers the persistent-journal contract: fingerprint stability/normalisation,
 * the recent-duplicate window, resolution semantics (only a definitive failure
 * clears the guard), the --force bypass, and fail-open robustness against a
 * missing/corrupt journal.
 */
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import {
  assertNoRecentDuplicate,
  type BroadcastIntent,
  computeFingerprint,
  DuplicateBroadcastError,
  findRecentDuplicate,
  journalPath,
  recordBroadcast,
  recordResolution,
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
