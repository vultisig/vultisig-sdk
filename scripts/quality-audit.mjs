#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const AUDIT_ARGS = ['npm', 'audit', '--recursive', '--all', '--severity', 'high']

export const STALE_LOCKFILE_HINT = [
  'quality:audit failed on this lockfile (absolute, not vs origin/main).',
  'If this advisory is already fixed on origin/main, merge main into your branch - that is the whole fix.',
  'This is not a lint or typecheck failure in your change.',
].join('\n')

export function runQualityAudit({
  spawn = spawnSync,
  write = text => console.error(text),
  exit = code => process.exit(code),
} = {}) {
  const result = spawn('yarn', AUDIT_ARGS, { stdio: 'inherit' })
  const status = typeof result.status === 'number' ? result.status : 1
  if (status !== 0) {
    write(`\n${STALE_LOCKFILE_HINT}\n`)
  }
  exit(status)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runQualityAudit()
}
