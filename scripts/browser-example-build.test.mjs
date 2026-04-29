import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const browserExampleRoot = path.join(repoRoot, 'examples/browser')
const requireFromBrowserExample = createRequire(path.join(repoRoot, 'examples/browser/package.json'))

/** Strip ANSI so Vite TTY output like `Local\u001b[22m:` still parses. */
function stripAnsi(text) {
  return text.replace(/\u001b\[[\d;]*m/g, '')
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  assert.equal(
    result.status,
    0,
    [`${command} ${args.join(' ')} failed`, result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n')
  )
}

function startDevServer() {
  const child = spawn('yarn', ['workspace', '@vultisig/example-browser', 'dev', '--host', '127.0.0.1', '--port', '0'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  const closed = new Promise(resolve => {
    child.once('close', resolve)
  })
  const waitForUrl = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for browser example dev server\n\n${output.trim()}`))
    }, 60_000)

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
      reject(new Error(`Browser example dev server exited with ${code}\n\n${output.trim()}`))
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

      if (process.platform === 'win32') {
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

test('browser example builds against the local SDK workspace package', { timeout: 180_000 }, () => {
  run('yarn', ['workspace', '@vultisig/example-browser', 'build'])

  assert.match(requireFromBrowserExample.resolve('@vultisig/sdk'), /packages[/\\]sdk[/\\]dist/)
  assert.match(requireFromBrowserExample.resolve('@vultisig/sdk/vite'), /packages[/\\]sdk[/\\]dist[/\\]vite/)
  assert.equal(typeof requireFromBrowserExample('@vultisig/sdk/vite'), 'function')
  assert.ok(existsSync(path.join(browserExampleRoot, 'dist/7zz.wasm')), 'expected browser build to emit 7zz.wasm')
  assert.ok(
    existsSync(path.join(browserExampleRoot, 'dist/assets/wallet-core.wasm')),
    'expected browser build to emit wallet-core.wasm next to built chunks'
  )
})

test('browser example dev server serves SDK wasm assets', { timeout: 90_000 }, async () => {
  const server = startDevServer()
  try {
    const baseUrl = await server.waitForUrl
    await assertWasmResponse(baseUrl, '/7zz.wasm')
    await assertWasmResponse(baseUrl, '/assets/wallet-core.wasm')
  } finally {
    await server.stop()
  }
})
