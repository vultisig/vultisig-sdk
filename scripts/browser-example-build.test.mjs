import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { applySharedExports } from './generate-shared-exports.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserExampleRoot = path.join(repoRoot, 'examples/browser')
const requireFromBrowserExample = createRequire(path.join(repoRoot, 'examples/browser/package.json'))

const isWin = process.platform === 'win32'

function freshnessFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-sdk-freshness-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceTime = 1_700_000_000
  const outputTime = sourceTime + 10
  const sharedOutputs = [
    'packages/core/config/dist/index.js',
    'packages/core/chain/dist/Chain.js',
    'packages/core/mpc/dist/MpcServerType.js',
    'packages/lib/utils/dist/attempt.js',
    'packages/mpc-types/dist/index.js',
    'packages/mpc-wasm/dist/index.js',
  ]
  const sdkOutputs = [
    'index.browser.js',
    'index.node.cjs',
    'index.d.ts',
    'vite/index.js',
    'vite/index.cjs',
    'vite/index.d.ts',
  ].map(file => `packages/sdk/dist/${file}`)
  const write = (relative, contents = '', time = sourceTime) => {
    const file = path.join(root, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, contents)
    utimesSync(file, time, time)
    return file
  }
  write('package.json', '{"type":"module"}')
  write('yarn.lock', '# fixture lockfile\n')
  write('.config/tsconfig.shared-publish.json', '{}\n')
  write('scripts/build-shared-packages.mjs', 'export {}\n')
  write('scripts/fix-dist-esm-relative-imports.mjs', 'export {}\n')
  write('scripts/generate-shared-exports.mjs', 'export {}\n')
  write('packages/sdk/package.json', '{}')
  write('packages/sdk/src/index.ts', 'export const value = 1')
  write('packages/core/chain/source.ts', 'export const chain = 1')
  write('packages/core/chain/package.json', '{"name":"@test/chain","type":"module"}\n')
  for (const file of [...sharedOutputs, ...sdkOutputs]) write(file, '', outputTime)

  // Resolution remains real, with a tiny package standing in for Yarn's link.
  write('examples/browser/package.json', '{}')
  write(
    'examples/browser/node_modules/@vultisig/sdk/package.json',
    JSON.stringify({
      name: '@vultisig/sdk',
      exports: { '.': './index.cjs', './vite': './vite.cjs' },
    })
  )
  write('examples/browser/node_modules/@vultisig/sdk/index.cjs')
  write('examples/browser/node_modules/@vultisig/sdk/vite.cjs')
  const script = write('examples/browser/scripts/ensure-local-sdk-build.mjs')
  copyFileSync(path.join(browserExampleRoot, 'scripts/ensure-local-sdk-build.mjs'), script)

  const bin = path.join(root, 'bin')
  write('bin/package.json', '{"type":"commonjs"}')
  const runner = write(
    'bin/build.cjs',
    `
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync('builds.jsonl', JSON.stringify(args) + '\\n');
if (process.env.FRESHNESS_BUILD_FAIL === '1') process.exit(1);
const files = args[0] === 'build:shared' ? ${JSON.stringify(sharedOutputs)} : ${JSON.stringify(sdkOutputs)};
for (const file of files) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}
`
  )
  const shim = write(
    isWin ? 'bin/yarn.cmd' : 'bin/yarn',
    isWin ? `@"${process.execPath}" "${runner}" %*\r\n` : `#!/usr/bin/env node\nrequire(${JSON.stringify(runner)})\n`
  )
  chmodSync(shim, 0o755)

  const dateDirectories = (directory, inOutput = false) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) dateDirectories(path.join(directory, entry.name), inOutput || entry.name === 'dist')
    }
    const time = inOutput ? outputTime : sourceTime
    utimesSync(directory, time, time)
  }
  dateDirectories(path.join(root, 'packages'))

  const prepare = (env = {}) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      },
    })
  const record = kind => {
    const start = spawnSync(process.execPath, [script, '--begin', kind], { cwd: root, encoding: 'utf8' })
    assert.equal(start.status, 0, start.stderr)
    const result = spawnSync(process.execPath, [script, '--record', kind], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  record('shared')
  record('sdk')
  const builds = () => {
    const log = path.join(root, 'builds.jsonl')
    return existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
  }
  return {
    root,
    write,
    prepare,
    record,
    script,
    builds,
    sharedOutputs,
    sdkOutputs,
    outputTime,
  }
}

test('browser SDK freshness reuses builds after output churn and unchanged export generation', t => {
  const fixture = freshnessFixture(t)
  const packageJson = path.join(fixture.root, 'packages/core/chain/package.json')
  const dist = path.dirname(path.join(fixture.root, fixture.sharedOutputs[1]))
  applySharedExports(packageJson, dist)
  utimesSync(packageJson, fixture.outputTime - 1, fixture.outputTime - 1)
  fixture.record('shared')
  fixture.record('sdk')
  const beforeMtime = statSync(packageJson).mtimeMs
  rmSync(dist, { recursive: true })
  fixture.write(fixture.sharedOutputs[1], '', fixture.outputTime)
  applySharedExports(packageJson, dist)
  assert.equal(statSync(packageJson).mtimeMs, beforeMtime)
  assert.ok(statSync(path.dirname(dist)).mtimeMs > fixture.outputTime * 1000)

  for (let i = 0; i < 2; i++) {
    const result = fixture.prepare()
    assert.equal(result.status, 0, result.stderr)
  }
  assert.deepEqual(fixture.builds(), [])
})

for (const input of [
  'package.json',
  'yarn.lock',
  'scripts/build-shared-packages.mjs',
  'packages/core/chain/source.ts',
  'packages/core/chain/package.json',
  'packages/sdk/src/index.ts',
  'packages/sdk/package.json',
]) {
  test(`browser SDK freshness rebuilds for changed ${input}`, t => {
    const fixture = freshnessFixture(t)
    fixture.write(
      input,
      input.endsWith('.json') ? '{"version":"2.0.0"}' : 'export const changed = 2',
      fixture.outputTime + 1
    )
    const result = fixture.prepare()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(
      fixture.builds(),
      input.includes('/sdk/')
        ? [['workspace', '@vultisig/sdk', 'build']]
        : [['build:shared'], ['workspace', '@vultisig/sdk', 'build']]
    )
    assert.equal(fixture.prepare().status, 0)
    assert.equal(fixture.builds().length, input.includes('/sdk/') ? 1 : 2)
  })
}

for (const kind of ['sharedOutputs', 'sdkOutputs']) {
  test(`browser SDK freshness restores missing ${kind}`, t => {
    const fixture = freshnessFixture(t)
    const missing = path.join(fixture.root, fixture[kind][0])
    rmSync(missing)
    const result = fixture.prepare()
    assert.equal(result.status, 0, result.stderr)
    assert.ok(existsSync(missing))
    assert.deepEqual(
      fixture.builds(),
      kind === 'sharedOutputs' ? [['build:shared']] : [['workspace', '@vultisig/sdk', 'build']]
    )
  })
}

test('browser SDK freshness propagates build failures', t => {
  const fixture = freshnessFixture(t)
  rmSync(path.join(fixture.root, fixture.sharedOutputs[0]))
  const result = fixture.prepare({ FRESHNESS_BUILD_FAIL: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Failed to build shared package artifacts/)
  assert.deepEqual(fixture.builds(), [['build:shared']])
})

for (const invalidReceipt of ['missing', 'null', 'malformed']) {
  test(`browser SDK freshness rebuilds with ${invalidReceipt} input records`, t => {
    const fixture = freshnessFixture(t)
    const receipt = path.join(fixture.root, '.rollup.cache/browser-sdk-build/sdk.json')
    if (invalidReceipt === 'missing') rmSync(receipt)
    else writeFileSync(receipt, invalidReceipt === 'null' ? 'null' : '{')
    const result = fixture.prepare()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(fixture.builds(), [['workspace', '@vultisig/sdk', 'build']])
  })
}

test('browser SDK freshness rejects inputs changed during a build, even with restored timestamps', t => {
  const fixture = freshnessFixture(t)
  const begin = spawnSync(process.execPath, [fixture.script, '--begin', 'sdk'], { cwd: fixture.root })
  assert.equal(begin.status, 0)
  fixture.write('packages/sdk/src/index.ts', 'export const value = 2')
  const recorded = spawnSync(process.execPath, [fixture.script, '--record', 'sdk'], {
    cwd: fixture.root,
    encoding: 'utf8',
  })
  assert.notEqual(recorded.status, 0)
  assert.match(recorded.stderr, /Inputs changed during the sdk build/)
  assert.equal(existsSync(path.join(fixture.root, '.rollup.cache/browser-sdk-build/sdk.json')), false)
})

test('browser SDK freshness allows generated export changes during a shared build', t => {
  const fixture = freshnessFixture(t)
  const begin = spawnSync(process.execPath, [fixture.script, '--begin', 'shared'], { cwd: fixture.root })
  assert.equal(begin.status, 0)
  applySharedExports(
    path.join(fixture.root, 'packages/core/chain/package.json'),
    path.join(fixture.root, 'packages/core/chain/dist')
  )
  const recorded = spawnSync(process.execPath, [fixture.script, '--record', 'shared'], {
    cwd: fixture.root,
    encoding: 'utf8',
  })
  assert.equal(recorded.status, 0, recorded.stderr)
  assert.equal(fixture.prepare().status, 0)
  assert.deepEqual(fixture.builds(), [])
})

test('browser SDK freshness invalidates corrupted generated export maps', t => {
  const fixture = freshnessFixture(t)
  const manifest = path.join(fixture.root, 'packages/core/chain/package.json')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  pkg.exports = { '.': './dist/missing.js' }
  writeFileSync(manifest, JSON.stringify(pkg))
  const result = fixture.prepare()
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(fixture.builds(), [['build:shared']])
})

for (const input of ['packages/core/chain/source.ts', 'packages/sdk/src/index.ts']) {
  for (const operation of ['delete', 'rename']) {
    test(`browser SDK freshness rebuilds after source ${operation}: ${input}`, t => {
      const fixture = freshnessFixture(t)
      const file = path.join(fixture.root, input)
      if (operation === 'delete') rmSync(file)
      else renameSync(file, `${file}.renamed.ts`)
      fixture.write(`${path.dirname(input)}/.cache/unrelated-output`, 'cache activity')
      const result = fixture.prepare()
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(
        fixture.builds(),
        input.includes('/sdk/')
          ? [['workspace', '@vultisig/sdk', 'build']]
          : [['build:shared'], ['workspace', '@vultisig/sdk', 'build']]
      )
    })
  }
}

/** Strip ANSI so Vite TTY output like `Local\u001b[22m:` still parses. */
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex -- ANSI output contains the ESC byte by definition.
  return text.replace(/\u001b\[[\d;]*m/g, '')
}

function quoteArg(arg) {
  const s = String(arg)
  if (/[\s"']/.test(s)) return `"${s.replaceAll('"', '\\"')}"`
  return s
}

function formatShellCommand(command, args) {
  return [command, ...args.map(quoteArg)].join(' ')
}

function tail(text, maxChars = 24_000) {
  const t = text.trimEnd()
  if (t.length <= maxChars) return t
  return `…(truncated, showing last ${maxChars} chars)…\n${t.slice(-maxChars)}`
}

/**
 * Run a child process with a wall-clock timeout, periodic heartbeat on stderr,
 * and an error that names the full command plus recent stdout/stderr.
 */
async function runWithDiagnostics(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 180_000
  const cwd = options.cwd ?? repoRoot
  const fullCommand = formatShellCommand(command, args)
  const label = options.label ?? fullCommand

  const child = spawn(command, args, {
    cwd,
    shell: isWin,
    detached: !isWin,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  const started = Date.now()
  let timedOut = false
  const heartbeat = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - started) / 1000)
    console.error(`[browser-example-build.test] still running after ${elapsedSec}s: ${label}`)
  }, 30_000)

  const killTimer = setTimeout(() => {
    timedOut = true
    try {
      if (isWin) child.kill()
      else process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    setTimeout(() => {
      try {
        if (isWin) child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
      }
    }, 10_000).unref?.()
  }, timeoutMs)

  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, exitSignal) => {
        resolve({ code: exitCode, signal: exitSignal })
      })
    })

    const ok = code === 0 && !signal
    if (ok) return

    const outcome = timedOut
      ? `timed out after ${timeoutMs}ms (process reported code=${code}, signal=${signal ?? 'none'})`
      : `exited with code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}`

    throw new Error(
      [
        `Child command failed: ${fullCommand}`,
        `Outcome: ${outcome}`,
        '',
        '--- stdout (tail) ---',
        tail(stdout),
        '',
        '--- stderr (tail) ---',
        tail(stderr),
      ].join('\n')
    )
  } finally {
    clearTimeout(killTimer)
    clearInterval(heartbeat)
  }
}

function startDevServer() {
  // The preceding build test already prepares the local SDK. Start Vite directly
  // so this assertion does not repeat the several-minute SDK build via `predev`.
  const devArgs = ['workspace', '@vultisig/example-browser', 'exec', 'vite', '--host', '127.0.0.1', '--port', '0']
  const fullDevCommand = formatShellCommand('yarn', devArgs)
  const child = spawn('yarn', devArgs, {
    cwd: repoRoot,
    detached: !isWin,
    shell: isWin,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const closed = new Promise(resolve => {
    child.once('close', resolve)
  })
  const waitForUrl = new Promise((resolve, reject) => {
    const startTimeoutMs = 600_000
    const timeout = setTimeout(() => {
      reject(
        new Error(
          [
            `Timed out waiting for browser example dev server (${startTimeoutMs}ms).`,
            `Child command: ${fullDevCommand}`,
            '',
            '--- recent combined stdout/stderr (tail) ---',
            tail(output),
          ].join('\n')
        )
      )
    }, startTimeoutMs)

    const onData = chunk => {
      output += chunk.toString()
      const plain = stripAnsi(output)
      const match = plain.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)
      if (!match) return

      clearTimeout(timeout)
      resolve(match[1])
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', code => {
      clearTimeout(timeout)
      reject(
        new Error(
          [
            `Browser example dev server exited with code ${code}.`,
            `Child command: ${fullDevCommand}`,
            '',
            '--- recent combined stdout/stderr (tail) ---',
            tail(output),
          ].join('\n')
        )
      )
    })
    child.once('error', error => {
      clearTimeout(timeout)
      reject(error)
    })
  })

  return {
    waitForUrl,
    async stop() {
      child.stdout.destroy()
      child.stderr.destroy()
      if (child.killed) return

      if (isWin) {
        child.kill()
      } else {
        process.kill(-child.pid, 'SIGTERM')
      }
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5_000))])
    },
  }
}

async function assertWasmResponse(baseUrl, pathname) {
  const response = await fetch(new URL(pathname, baseUrl))
  assert.equal(response.status, 200, `expected ${pathname} to be served by the dev server`)
  assert.equal(response.headers.get('content-type'), 'application/wasm', `expected ${pathname} wasm MIME type`)
  assert.ok((await response.arrayBuffer()).byteLength > 0, `expected ${pathname} to have a non-empty body`)
}

describe('browser example integration', () => {
  test.after(async () => {
    await runWithDiagnostics('yarn', ['build:shared'], {
      timeoutMs: 600_000,
      label: formatShellCommand('yarn', ['build:shared']) + ' (suite teardown: restore shared dist)',
    })
  })

  test('browser example prepare recreates missing shared package artifacts', { timeout: 1_560_000 }, async () => {
    const mpcWasmDist = path.join(repoRoot, 'packages/mpc-wasm/dist')
    rmSync(mpcWasmDist, { recursive: true, force: true })

    try {
      await runWithDiagnostics('yarn', ['workspace', '@vultisig/example-browser', 'prepare:sdk'], {
        timeoutMs: 900_000,
        label: formatShellCommand('yarn', ['workspace', '@vultisig/example-browser', 'prepare:sdk']),
      })
      assert.ok(existsSync(path.join(mpcWasmDist, 'index.js')), 'expected prepare:sdk to rebuild mpc-wasm dist')
    } finally {
      await runWithDiagnostics('yarn', ['build:shared'], {
        timeoutMs: 600_000,
        label: formatShellCommand('yarn', ['build:shared']) + ' (restore after prepare test)',
      })
    }
  })

  test('browser example builds against the local SDK workspace package', { timeout: 960_000 }, async () => {
    await runWithDiagnostics('yarn', ['workspace', '@vultisig/example-browser', 'build'], {
      timeoutMs: 900_000,
      label: formatShellCommand('yarn', ['workspace', '@vultisig/example-browser', 'build']),
    })

    assert.match(requireFromBrowserExample.resolve('@vultisig/sdk'), /packages[/\\]sdk[/\\]dist/)
    assert.match(requireFromBrowserExample.resolve('@vultisig/sdk/vite'), /packages[/\\]sdk[/\\]dist[/\\]vite/)
    assert.equal(typeof requireFromBrowserExample('@vultisig/sdk/vite'), 'function')
    assert.ok(existsSync(path.join(browserExampleRoot, 'dist/7zz.wasm')), 'expected browser build to emit 7zz.wasm')
    assert.ok(
      existsSync(path.join(browserExampleRoot, 'dist/assets/wallet-core.wasm')),
      'expected browser build to emit wallet-core.wasm next to built chunks'
    )
  })

  test('browser example dev server serves SDK wasm assets', { timeout: 660_000 }, async () => {
    const server = startDevServer()
    try {
      const baseUrl = await server.waitForUrl
      await assertWasmResponse(baseUrl, '/7zz.wasm')
      await assertWasmResponse(baseUrl, '/assets/wallet-core.wasm')
    } finally {
      await server.stop()
    }
  })
})
