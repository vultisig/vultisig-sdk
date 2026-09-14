import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(new URL('../packages/sdk/package.json', import.meta.url))
const concurrentlyRoot = path.dirname(require.resolve('concurrently/package.json'))

async function fixture(t, { limit, delay = 100, failure = -1, rendezvousWidth = 0 } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sdk-platform-build-')))
  const sdk = path.join(root, 'packages/sdk')
  await mkdir(sdk, { recursive: true })
  await mkdir(path.join(root, 'scripts'))
  await mkdir(path.join(root, 'node_modules'))
  await symlink(concurrentlyRoot, path.join(root, 'node_modules/concurrently'), 'junction')
  await copyFile(path.join(scriptRoot, 'build-sdk-platforms.mjs'), path.join(root, 'scripts/build-sdk-platforms.mjs'))
  const eventsFile = path.join(root, 'events.jsonl')
  const worker = path.join(root, 'worker.mjs')
  await writeFile(worker, `import { appendFileSync, readFileSync } from 'node:fs';
const [file, index, delay, failure, width] = process.argv.slice(2);
const record = phase => appendFileSync(file, JSON.stringify({ phase, index: Number(index), pid: process.pid, cwd: process.cwd() }) + '\\n');
record('start');
const finish = () => setTimeout(() => { record('end'); process.exit(Number(index) === Number(failure) ? 17 : 0) }, Number(delay));
if (Number(width) > 0) {
  const target = Math.min(6, (Math.floor(Number(index) / Number(width)) + 1) * Number(width));
  const deadline = Date.now() + 9000;
  const barrier = setInterval(() => {
    const starts = readFileSync(file, 'utf8').trim().split('\\n').filter(line => JSON.parse(line).phase === 'start').length;
    if (starts >= target) { clearInterval(barrier); finish(); }
    else if (Date.now() >= deadline) { clearInterval(barrier); process.exit(18); }
  }, 10);
} else finish();
`)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('CONCURRENTLY_')) delete env[key]
  if (limit !== undefined) env.CONCURRENTLY_MAX_PROCESSES = limit
  const commands = Array.from({ length: 6 }, (_, index) => `"${process.execPath}" "${worker}" "${eventsFile}" ${index} ${delay} ${failure} ${rendezvousWidth}`)
  const child = spawn(process.execPath, [path.join(root, 'scripts/build-sdk-platforms.mjs'), ...commands], {
    cwd: sdk, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  // Bound even an event-loop regression that cannot process graceful signals.
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 12000)
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { clearTimeout(watchdog); resolve({ code, signal }) })
  })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await completed
    await rm(root, { recursive: true, force: true })
  })
  const events = async () => {
    try { return (await readFile(eventsFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  return { child, completed, events, sdk, output: () => output }
}

function peakConcurrency(events) {
  let active = 0
  let peak = 0
  for (const event of events) {
    active += event.phase === 'start' ? 1 : -1
    assert.ok(active >= 0)
    peak = Math.max(peak, active)
  }
  assert.equal(active, 0)
  return peak
}

for (const [name, limit, expectedPeak] of [['default', undefined, 1], ['explicit override', '2', 2], ['large valid override', '9007199254740991', 6]]) {
  test(`${name} runs all six commands within the limit and preserves cwd/output`, { timeout: 15000 }, async t => {
    // Workers rendezvous in bounded groups, so overlap does not depend on
    // startup speed or an arbitrary short sleep on a loaded CI machine.
    const run = await fixture(t, { limit, delay: 0, rendezvousWidth: expectedPeak })
    assert.deepEqual(await run.completed, { code: 0, signal: null }, run.output())
    const events = await run.events()
    assert.equal(peakConcurrency(events), expectedPeak)
    assert.deepEqual(events.filter(e => e.phase === 'end').map(e => e.index).sort(), [0, 1, 2, 3, 4, 5])
    assert.ok(events.every(e => e.cwd === run.sdk))
    assert.match(run.output(), /exited with code 0/)
  })
}

test('invalid limits fail before any command starts', { timeout: 15000 }, async t => {
  for (const limit of ['', '0', '-1', '1.5', '50%', 'NaN', ' 2 ', '9007199254740992']) {
    const run = await fixture(t, { limit })
    assert.equal((await run.completed).code, 1, limit)
    assert.deepEqual(await run.events(), [], limit)
    assert.match(run.output(), /must be a positive integer/)
  }
})

test('a failed command keeps the full build unsuccessful even when later commands succeed', { timeout: 15000 }, async t => {
  const run = await fixture(t, { failure: 1 })
  assert.equal((await run.completed).code, 1, run.output())
  assert.equal((await run.events()).filter(e => e.phase === 'end').length, 6)
  assert.match(run.output(), /exited with code 17/)
})

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`${signal} stops active children and queued commands without reporting success`, {
    timeout: 15000, skip: process.platform === 'win32' && 'POSIX signal semantics',
  }, async t => {
    const run = await fixture(t, { delay: 10000 })
    const deadline = Date.now() + 5000
    while ((await run.events()).length === 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const started = await run.events()
    assert.equal(started.length, 1, run.output())
    assert.equal(run.child.kill(signal), true)
    assert.deepEqual(await run.completed, { code, signal: null }, run.output())
    assert.deepEqual(await run.events(), started)
    for (const event of started) {
      assert.throws(() => process.kill(event.pid, 0), error => error.code === 'ESRCH')
    }
  })
}
