import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const availablePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })

export async function smokeToolsBrowser({ appRoot, repoRoot }) {
  writeFileSync(
    path.join(appRoot, 'vite.config.mjs'),
    "import vultisig from '@vultisig/sdk/vite'\nexport default { plugins: [vultisig()], build: { target: 'esnext' } }\n"
  )
  writeFileSync(
    path.join(appRoot, 'index.html'),
    '<!doctype html><html><body data-result="pending"><script type="module" src="/tools-browser.mjs"></script></body></html>\n'
  )
  writeFileSync(
    path.join(appRoot, 'tools-browser.mjs'),
    `import { decodeFromToolResult, findSwapQuote, gas, parseChain, prep, token } from '@vultisig/sdk/tools'
const valid = typeof decodeFromToolResult === 'function' && typeof findSwapQuote === 'function' &&
  typeof gas.compareCosts === 'function' && typeof token.searchToken === 'function' &&
  typeof prep.buildDelegateMsg === 'function' && parseChain('Ethereum').success
document.body.dataset.result = valid ? 'pass' : 'fail'
document.body.textContent = valid ? 'tools browser import passed' : 'tools browser import failed'
`
  )
  execFileSync(path.join(repoRoot, 'node_modules/.bin/vite'), ['build'], {
    cwd: appRoot,
    stdio: 'inherit',
  })

  // CI can run the packed browser build without a local Chrome installation.
  // Set this during attended QA to exercise the emitted bundle in a real browser.
  if (process.env.SDK_TOOLS_BROWSER_SMOKE !== '1') return

  const chrome =
    process.env.CHROME_BIN ||
    execFileSync(path.join(repoRoot, 'node_modules/.bin/print-chrome-path'), {
      encoding: 'utf8',
    }).trim()
  if (!chrome) throw new Error('Chrome is required for SDK_TOOLS_BROWSER_SMOKE=1')

  const port = await availablePort()
  const server = spawn(
    'python3',
    ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', path.join(appRoot, 'dist')],
    {
      stdio: 'ignore',
    }
  )
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`)
        ready = response.ok
        if (ready) break
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!ready) throw new Error('Browser smoke server did not become ready')
    mkdirSync(path.join(appRoot, 'chrome-profile'))
    let html
    try {
      html = execFileSync(
        chrome,
        [
          '--headless=new',
          '--no-first-run',
          '--disable-gpu',
          '--disable-background-networking',
          `--user-data-dir=${path.join(appRoot, 'chrome-profile')}`,
          '--virtual-time-budget=10000',
          '--dump-dom',
          `http://127.0.0.1:${port}/`,
        ],
        { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }
      )
    } catch (error) {
      // Chrome can keep a background process alive after --dump-dom writes the
      // completed page. The bounded timeout kills it; accept only a PASS DOM.
      if (error.code !== 'ETIMEDOUT' || !String(error.stdout).includes('data-result="pass"')) throw error
      html = String(error.stdout)
    }
    if (!html.includes('data-result="pass"'))
      throw new Error(`Packed browser tools import failed: ${html.slice(0, 400)}`)
    console.log('Packed browser tools import passed in Chrome')
  } finally {
    server.kill('SIGTERM')
  }
}
