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
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach } from 'vitest'

const journalFile = join(mkdtempSync(join(tmpdir(), 'vultisig-cli-test-')), 'broadcasts.jsonl')
process.env.VULTISIG_BROADCAST_JOURNAL_PATH = process.env.VULTISIG_BROADCAST_JOURNAL_PATH || journalFile

beforeEach(() => {
  const path = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  if (path) rmSync(path, { force: true })
})
