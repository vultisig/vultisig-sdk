import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cliTest = process.platform === 'win32' ? test.skip : test
// These CLI fixtures use a POSIX executable shim; native Windows audit behavior is unchanged.

const auditScript = fileURLToPath(new URL('./run-npm-audit.mjs', import.meta.url))

async function runFixture(t, mode) {
  const directory = mkdtempSync(path.join(tmpdir(), 'audit-cli-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const fixture = path.join(directory, 'fixture.cjs')
  writeFileSync(
    fixture,
    `const fs = require('node:fs');
const countPath = process.env.AUDIT_TEST_COUNT;
const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath, 'utf8')) + 1 : 1;
fs.writeFileSync(countPath, String(count));
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['npm', 'audit', '--recursive', '--all', '--severity', 'high'])) process.exit(99);
if (process.env.AUDIT_TEST_MODE === 'retry' && count === 1) {
  console.error('ECONNRESET'); process.exit(1);
}
console.log('audit output');
if (process.env.AUDIT_TEST_MODE === 'failure') { console.error('high advisory'); process.exit(42); }
`
  )
  writeFileSync(path.join(directory, 'yarn'), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, {
    mode: 0o755,
  })
  const child = spawn(process.execPath, [auditScript], {
    env: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
      AUDIT_TEST_COUNT: path.join(directory, 'count'),
      AUDIT_TEST_MODE: mode,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => (stdout += chunk))
  child.stderr.on('data', chunk => (stderr += chunk))
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  return {
    code,
    stdout,
    stderr,
    attempts: Number(readFileSync(path.join(directory, 'count'), 'utf8')),
  }
}

cliTest('successful audit preserves output without a stale-lockfile hint', async t => {
  const result = await runFixture(t, 'success')
  assert.equal(result.code, 0)
  assert.equal(result.attempts, 1)
  assert.equal(result.stdout, 'audit output\n')
  assert.equal(result.stderr, '')
})

cliTest('advisory failure preserves exit status and prints the conditional main remedy', async t => {
  const result = await runFixture(t, 'failure')
  assert.equal(result.code, 42)
  assert.equal(result.attempts, 1)
  assert.match(result.stderr, /high advisory/)
  assert.match(result.stderr, /absolute, not vs origin\/main/)
  assert.match(result.stderr, /If this advisory is already fixed on origin\/main, merge main/)
})

cliTest('transient error still retries and recovery does not print the stale-lockfile hint', async t => {
  const result = await runFixture(t, 'retry')
  assert.equal(result.code, 0)
  assert.equal(result.attempts, 2)
  assert.match(result.stderr, /ECONNRESET/)
  assert.match(result.stderr, /retrying in 5s/)
  assert.doesNotMatch(result.stderr, /quality:audit failed/)
})
