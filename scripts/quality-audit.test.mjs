import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AUDIT_ARGS, STALE_LOCKFILE_HINT, runQualityAudit } from './quality-audit.mjs'

test('hint tells a stale branch to merge main instead of chasing lint', () => {
  assert.match(STALE_LOCKFILE_HINT, /merge main into your branch/)
  assert.match(STALE_LOCKFILE_HINT, /not a lint or typecheck failure/)
  assert.match(STALE_LOCKFILE_HINT, /absolute, not vs origin\/main/)
})

test('passing audit exits 0 and does not print the stale-branch hint', () => {
  const writes = []
  const exits = []

  runQualityAudit({
    spawn: (cmd, args) => {
      assert.equal(cmd, 'yarn')
      assert.deepEqual(args, AUDIT_ARGS)
      return { status: 0 }
    },
    write: text => writes.push(text),
    exit: code => exits.push(code),
  })

  assert.deepEqual(writes, [])
  assert.deepEqual(exits, [0])
})

test('failing audit still fails, but names the merge-main remedy', () => {
  const writes = []
  const exits = []

  runQualityAudit({
    spawn: () => ({ status: 1 }),
    write: text => writes.push(text),
    exit: code => exits.push(code),
  })

  assert.equal(exits[0], 1)
  assert.match(writes.join(''), /merge main into your branch/)
})
