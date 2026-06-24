import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserExampleRoot = path.join(repoRoot, 'examples/browser')
const requireFromBrowserExample = createRequire(path.join(repoRoot, 'examples/browser/package.json'))

const isWin = process.platform === 'win32'

/** Strip ANSI so Vite TTY output like `Local\u001b[22m:` still parses. */
function stripAnsi(text) {
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

test.after(async () => {
  await runWithDiagnostics('yarn', ['build:shared'], {
    timeoutMs: 300_000,
    label: formatShellCommand('yarn', ['build:shared']) + ' (suite teardown: restore shared dist)',
  })
})

function startDevServer() {
  const devArgs = ['workspace', '@vultisig/example-browser', 'dev', '--host', '127.0.0.1', '--port', '0']
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
    const startTimeoutMs = 180_000
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

test('browser example prepare recreates missing shared package artifacts', { timeout: 540_000 }, async () => {
  const mpcWasmDist = path.join(repoRoot, 'packages/mpc-wasm/dist')
  rmSync(mpcWasmDist, { recursive: true, force: true })

  try {
    await runWithDiagnostics('yarn', ['workspace', '@vultisig/example-browser', 'prepare:sdk'], {
      timeoutMs: 360_000,
      label: formatShellCommand('yarn', ['workspace', '@vultisig/example-browser', 'prepare:sdk']),
    })
    assert.ok(existsSync(path.join(mpcWasmDist, 'index.js')), 'expected prepare:sdk to rebuild mpc-wasm dist')
  } finally {
    await runWithDiagnostics('yarn', ['build:shared'], {
      timeoutMs: 300_000,
      label: formatShellCommand('yarn', ['build:shared']) + ' (restore after prepare test)',
    })
  }
})

test('browser example builds against the local SDK workspace package', { timeout: 420_000 }, async () => {
  await runWithDiagnostics('yarn', ['workspace', '@vultisig/example-browser', 'build'], {
    timeoutMs: 360_000,
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

test('browser example dev server serves SDK wasm assets', { timeout: 240_000 }, async () => {
  const server = startDevServer()
  try {
    const baseUrl = await server.waitForUrl
    await assertWasmResponse(baseUrl, '/7zz.wasm')
    await assertWasmResponse(baseUrl, '/assets/wallet-core.wasm')
  } finally {
    await server.stop()
  }
})
