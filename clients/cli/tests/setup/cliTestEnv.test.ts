/**
 * `cliTestEnv` journal override (review item 5).
 *
 * The setup MUST point VULTISIG_BROADCAST_JOURNAL_PATH at a throwaway temp file
 * UNCONDITIONALLY — even if a dev exported that var pointing at their real
 * ~/.vultisig/broadcasts.jsonl. The old setup preserved a pre-set value and then
 * rmSync'd it before every test, which would wipe the real journal.
 */
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { applyTestJournalOverride } from './cliTestEnv'

describe('cliTestEnv journal override', () => {
  const saved = process.env.VULTISIG_BROADCAST_JOURNAL_PATH

  afterEach(() => {
    if (saved === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
    else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = saved
  })

  it('ignores an exported VULTISIG_BROADCAST_JOURNAL_PATH (never targets the real journal)', () => {
    // Simulate a dev who exported the real journal path in their shell.
    const exported = '/home/dev/.vultisig/broadcasts.jsonl'
    process.env.VULTISIG_BROADCAST_JOURNAL_PATH = exported

    const path = applyTestJournalOverride()

    // The override wins: env is repointed at a fresh temp file, not the dev's.
    expect(path).not.toBe(exported)
    expect(process.env.VULTISIG_BROADCAST_JOURNAL_PATH).toBe(path)
    expect(path.startsWith(tmpdir())).toBe(true)
    expect(path.endsWith('broadcasts.jsonl')).toBe(true)
  })

  it('the ambient setup already pointed the journal at a temp file', () => {
    // The global setup ran at import time; its choice must be a temp path.
    const active = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
    expect(active).toBeDefined()
    expect(active!.startsWith(tmpdir())).toBe(true)
  })
})
