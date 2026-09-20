import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

// Pass an isolated application with a packed SDK installed. No SDK aliases,
// Buffer injection, root import, or consumer polyfills are used in this test.
export async function smokePortableConsumers({ appRoot, playwrightModule, hermes }) {
  const source = `
import * as balance from '@vultisig/sdk/tools/balance'
import * as defi from '@vultisig/sdk/tools/defi'
function assert(condition, label) { if (!condition) throw new Error(label) }
assert(typeof globalThis.Buffer === 'undefined', 'test must start without global Buffer')
assert(balance.formatBalance(1500000n, 6) === '1.5', 'balance formatting')
assert(balance.decodeBittensorAddress('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY').length === 32, 'SS58 decoding')
assert(defi.stripChainPrefix('1-0x1234') === '0x1234', 'DeFi helper')
assert(typeof defi.defi.stakekit === 'object', 'StakeKit exports')
globalThis.portableResult = { balance: Object.keys(balance).sort(), defi: Object.keys(defi).sort(), hermes: typeof HermesInternal !== 'undefined' }
globalThis.runPortableRequests = async base => {
  AbortSignal.timeout = undefined
  const originalFetch = globalThis.fetch
  globalThis.fetch = (url, init) => originalFetch(base + '/fixture?target=' + encodeURIComponent(String(url)), init)
  try {
    const token = await balance.getTrc20TokenBalance('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t','TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t')
    assert(token.symbol === 'USDT' && token.balance === '1500000' && token.decimals === 6, 'Tron conversion without Buffer')
    const cosmos = await balance.getCosmosBalance('Cosmos','cosmos1fixture')
    assert(cosmos.nativeRaw === '1500000' && cosmos.nativeFormatted === '1.5', 'Cosmos read')
    const stakekit = await defi.defi.stakekit.balances({address:'0x0000000000000000000000000000000000000001',network:'ethereum'})
    let deadline = false
    try { await balance.getUtxoBalance('Bitcoin', 'fixture', {blockchairBase: base + '/stall', timeoutMs:100}) }
    catch (error) { deadline = error.name === 'FetchTimeoutError' }
    assert(deadline, 'stalled response body must time out')
    return {token, cosmos, stakekit, stalledBodyDeadline:deadline}
  } finally { globalThis.fetch = originalFetch }
}
if (typeof print === 'function') print(JSON.stringify(globalThis.portableResult))
`
  const entry = path.join(appRoot, 'portable-entry.js')
  writeFileSync(entry, source)
  for (const condition of ['browser', 'worker', 'react-native']) {
    const output = path.join(appRoot, `portable-${condition}.js`)
    const bundle = await build({
      entryPoints: [entry],
      outfile: output,
      bundle: true,
      format: 'iife',
      platform: condition === 'react-native' ? 'neutral' : 'browser',
      conditions: [condition],
      mainFields: ['browser', 'module', 'main'],
      target: 'es2020',
      metafile: true,
    })
    for (const surface of ['balance', 'defi']) {
      const suffix = condition === 'react-native' ? 'react-native' : 'browser'
      if (
        !Object.keys(bundle.metafile.inputs).some(key => key.endsWith(`/sdk/dist/tools/${surface}/index.${suffix}.js`))
      ) {
        throw new Error(`Wrong ${condition} resolution for ${surface}`)
      }
    }
    writeFileSync(path.join(appRoot, `portable-${condition}.meta.json`), JSON.stringify(bundle.metafile))
  }
  if (hermes) {
    // Hermes consumes Metro/Babel-transformed JavaScript in React Native.
    // Use RN's real preset, without adding any runtime global shims.
    const require = createRequire(path.join(appRoot, 'package.json'))
    const { transformSync } = require('@babel/core')
    const nativeFile = path.join(appRoot, 'portable-react-native.js')
    const transformed = transformSync(readFileSync(nativeFile, 'utf8'), {
      filename: nativeFile,
      configFile: false,
      babelrc: false,
      compact: false,
      presets: [[require.resolve('@react-native/babel-preset'), { enableBabelRuntime: false }]],
    })
    const hermesFile = path.join(appRoot, 'portable-hermes.js')
    writeFileSync(hermesFile, transformed.code)
    execFileSync(hermes, [hermesFile], { stdio: 'inherit' })
  }
  if (!playwrightModule) return
  const { chromium } = await import(pathToFileURL(playwrightModule))
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.url.startsWith('/portable-')) {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(readFileSync(path.join(appRoot, req.url.slice(1))))
    } else if (req.url.startsWith('/fixture')) {
      let raw = ''
      for await (const part of req) raw += part
      const body = raw ? JSON.parse(raw) : {}
      const target = new URL(req.url, 'http://localhost').searchParams.get('target')
      if (target.includes('/stall/')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{"data":')
        return
      }
      let data
      if (target.includes('triggerconstantcontract')) {
        const values = {
          'balanceOf(address)': '16e360',
          'decimals()': '06',
          'symbol()': '20'.padStart(64, '0') + '04'.padStart(64, '0') + '55534454'.padEnd(64, '0'),
        }
        data = { constant_result: [values[body.function_selector]] }
      } else if (target.includes('/balances/')) data = { balances: [{ denom: 'uatom', amount: '1500000' }] }
      else if (target.includes('/yields/balances')) data = []
      else if (target.includes('/yields/enabled'))
        data = { data: [{ id: 'fixture', token: { network: 'ethereum' }, status: { enter: true } }] }
      else {
        res.writeHead(500)
        res.end(JSON.stringify({ error: 'Unexpected request ' + target }))
        return
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(data))
    } else {
      res.setHeader('Content-Type', 'text/html')
      res.end('<!doctype html><title>SDK portable imports</title>')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
    const page = await browser.newPage()
    await page.goto(origin)
    await page.addScriptTag({ url: origin + '/portable-browser.js' })
    const browserResult = await page.evaluate(
      async origin => ({ imports: globalThis.portableResult, requests: await globalThis.runPortableRequests(origin) }),
      origin
    )
    const workerResult = await page.evaluate(
      origin =>
        new Promise((resolve, reject) => {
          const blob = new Blob(
            [
              `importScripts('${origin}/portable-worker.js');runPortableRequests('${origin}').then(requests=>postMessage({imports:portableResult,requests}),error=>{throw error})`,
            ],
            { type: 'text/javascript' }
          )
          const url = URL.createObjectURL(blob)
          const worker = new Worker(url)
          const timer = setTimeout(() => {
            worker.terminate()
            URL.revokeObjectURL(url)
            reject(new Error('worker timeout'))
          }, 60_000)
          worker.onmessage = event => {
            clearTimeout(timer)
            worker.terminate()
            URL.revokeObjectURL(url)
            resolve(event.data)
          }
          worker.onerror = event => {
            clearTimeout(timer)
            worker.terminate()
            URL.revokeObjectURL(url)
            reject(new Error(event.message))
          }
        }),
      origin
    )
    console.log(JSON.stringify({ runtime: await browser.version(), browser: browserResult, worker: workerResult }))
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smokePortableConsumers({
    appRoot: path.resolve(process.argv[2]),
    playwrightModule: process.argv[3],
    hermes: process.argv[4],
  })
}
