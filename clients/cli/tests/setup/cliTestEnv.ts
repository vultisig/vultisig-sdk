/**
 * Global CLI test setup.
 *
 * Points the broadcast journal at a per-worker temp file (via the dedicated
 * VULTISIG_BROADCAST_JOURNAL_PATH override, which does NOT disturb
 * VULTISIG_CONFIG_DIR / credential-store path resolution) so tests never touch
 * the real ~/.vultisig/broadcasts.jsonl, and clears it before every test so
 * repeated identical broadcasts across a suite don't trip the F1/F14
 * double-spend guard (see src/agent/broadcastJournal.ts). Individual tests may
 * still override the same var in their own beforeEach for finer isolation.
 *
 * The override is UNCONDITIONAL. A previous version preserved a pre-set
 * VULTISIG_BROADCAST_JOURNAL_PATH and then rmSync'd it before every test — so a
 * dev who exported that var pointing at their REAL journal would have it wiped
 * the moment they ran the suite. Tests must own a throwaway path regardless of
 * the ambient environment.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach } from 'vitest'

/**
 * Force VULTISIG_BROADCAST_JOURNAL_PATH to a fresh throwaway temp file,
 * IGNORING any value the ambient environment already set. Returns the path.
 */
export function applyTestJournalOverride(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'vultisig-cli-test-')), 'broadcasts.jsonl')
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = path
  return path
}

// Captured in a closure const (not re-read from process.env) so cleanup targets
// this file's throwaway journal even if an individual test mutates the env var.
const journalFile = applyTestJournalOverride()

beforeEach(() => {
  rmSync(journalFile, { force: true })
})
