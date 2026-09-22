import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { build } from 'esbuild'
import { serializeTransaction } from 'viem'

// Invoke after installing a freshly built SDK archive into an isolated app:
// node scripts/smoke-sdk-decode-consumers.mjs <app-root> <playwright-core-module> <hermes-binary> <rn-babel-preset> <babel-core-module>
const [appRoot, playwrightModule, hermes, babelPreset, babelCore] = process.argv.slice(2)
if (!appRoot || !playwrightModule || !hermes || !babelPreset || !babelCore) {
  throw new Error('Pass the installed app, Playwright module, Hermes binary, RN Babel preset, and Babel core paths')
}
const appRequire = createRequire(path.join(appRoot, 'package.json'))
const sdkRoot = path.resolve(path.dirname(appRequire.resolve('@vultisig/sdk/tools/decode')), '../../..')
const archiveIdentity = createHash('sha256')
  .update(readFileSync(path.join(sdkRoot, 'package.json')))
  .digest('hex')

const evm = serializeTransaction({
  to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  value: 123n,
  data: '0x',
  chainId: 1,
  nonce: 0,
  gas: 60_000n,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
  type: 'eip1559',
})
const send = Any.fromPartial({
  typeUrl: '/cosmos.bank.v1beta1.MsgSend',
  value: MsgSend.encode(
    MsgSend.fromPartial({
      fromAddress: 'cosmos1pkptre7fdkl6gfrzlesjjvhxhlc3r4gmmk8rs6',
      toAddress: 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu',
      amount: [{ denom: 'uatom', amount: '2500000' }],
    })
  ).finish(),
})
const cw20 = Any.fromPartial({
  typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
  value: MsgExecuteContract.encode(
    MsgExecuteContract.fromPartial({
      sender: 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7',
      contract: 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77',
      msg: new TextEncoder().encode(
        JSON.stringify({
          transfer: {
            recipient: 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h',
            amount: '123',
          },
        })
      ),
    })
  ).finish(),
})
const txBytes = message => [
  ...TxRaw.encode(
    TxRaw.fromPartial({
      bodyBytes: TxBody.encode(TxBody.fromPartial({ messages: [message] })).finish(),
      authInfoBytes: new Uint8Array(),
      signatures: [],
    })
  ).finish(),
]
const cosmosBytes = txBytes(send)
const cw20Bytes = txBytes(cw20)
const invalidCw20Bytes = txBytes(
  Any.fromPartial({
    typeUrl: '/cosmwasm.wasm.v1.MsgExecuteContract',
    value: MsgExecuteContract.encode(
      MsgExecuteContract.fromPartial({
        sender: 'osmo1c3a7qq6trpvdver98agv6d9cqex94889k5ejr7',
        contract: 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77',
        msg: Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
      })
    ).finish(),
  })
)
const cosmosBase64 = Buffer.from(cosmosBytes).toString('base64')
const voteBase64 =
  'CmAKXgoWL2Nvc21vcy5nb3YudjEuTXNnVm90ZRJECJ0HEitvc21vMXJ1bno2ZHBtZ2Z5NHE0Njd2NGs4eDc1cDN6OGVkOGR5eHFscGh0GAEiEGlwZnM6Ly92b3RlLW5vdGU='
const source = `
import { decodeFromToolResult, decodeEvmTx, decodeCosmosTx, decode } from '@vultisig/sdk/tools/decode'
function check(ok, label) { if (!ok) throw new Error(label) }
check(typeof globalThis.Buffer === 'undefined', 'consumer must not provide global Buffer')
check(decode.fromToolResult === decodeFromToolResult, 'namespace export')
const evm = ${JSON.stringify(evm)}
const evmBytes = Uint8Array.from(evm.slice(2).match(/../g), x => parseInt(x, 16))
const cosmosBytes = Uint8Array.from(${JSON.stringify(cosmosBytes)})
const cw20Bytes = Uint8Array.from(${JSON.stringify(cw20Bytes)})
const invalidCw20Bytes = Uint8Array.from(${JSON.stringify(invalidCw20Bytes)})
const evmHex = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: evm })
const evmRaw = decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: evmBytes })
const evmDirect = decodeEvmTx(evmBytes, 'ethereum')
for (const value of [evmHex, evmRaw, evmDirect]) {
  check(value.decoded && value.kind === 'transfer' && value.family === 'evm', 'EVM envelope')
  check(value.recipient.toLowerCase() === '0x70997970c51812dc3a010c7d01b50e0d17dc79c8' && value.amount === '123', 'EVM fields')
}
const cosmosBase64 = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: ${JSON.stringify(cosmosBase64)} })
const cosmosRaw = decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: cosmosBytes })
const cosmosDirect = decodeCosmosTx(cosmosBytes, 'cosmoshub-4')
for (const value of [cosmosBase64, cosmosRaw, cosmosDirect]) {
  check(value.decoded && value.family === 'cosmos' && value.kind === 'transfer', 'Cosmos envelope')
  check(value.recipient === 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu' && value.amount === '2500000', 'Cosmos fields')
  check(value.asset.contract === 'uatom' && value.asset.symbol === 'ATOM', 'Cosmos asset')
}
const cw20 = decodeCosmosTx(cw20Bytes, 'osmosis-1')
check(cw20.decoded && cw20.kind === 'transfer', 'CW20 envelope')
check(cw20.recipient === 'osmo12f8hyk2prj2f5w2j3at9ndrxw390ejkr5nt99h' && cw20.amount === '123', 'CW20 fields')
check(cw20.asset.contract === 'osmo1kyekxn2qmcjt902sywxm42a2h2d35ssn9ljpvuf77mewevup4kds298e77', 'CW20 asset')
const invalidCw20 = decodeCosmosTx(invalidCw20Bytes, 'osmosis-1')
check(invalidCw20.decoded && invalidCw20.kind === 'contractCall', 'CW20 invalid UTF-8 remains generic')
const vote = decodeFromToolResult({ family: 'cosmos', chain: 'osmosis-1', payload: ${JSON.stringify(voteBase64)} })
check(vote.decoded && vote.kind === 'vote' && vote.cosmosAction.proposalId === '925' && vote.cosmosAction.voteOption === 'VOTE_OPTION_YES', 'governance vote')
check(!decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: '0x123' }).decoded, 'malformed hex')
check(!decodeFromToolResult({ family: 'cosmos', chain: 'cosmoshub-4', payload: 'AA=A' }).decoded, 'malformed base64')
globalThis.decodeSmokeResult = { evm: evmHex, cosmos: cosmosBase64, cw20 }
if (typeof print === 'function') print(JSON.stringify(globalThis.decodeSmokeResult))
if (typeof postMessage === 'function' && typeof document === 'undefined') postMessage(globalThis.decodeSmokeResult)
`
const entry = path.join(appRoot, 'decode-entry.js')
writeFileSync(entry, source)
for (const condition of ['browser', 'worker', 'react-native']) {
  const outfile = path.join(appRoot, `decode-${condition}.js`)
  const result = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: condition === 'react-native' ? 'neutral' : 'browser',
    conditions: [condition],
    mainFields: ['browser', 'module', 'main'],
    target: 'es2020',
    metafile: true,
  })
  const suffix = condition === 'react-native' ? 'react-native' : 'browser'
  assert.ok(
    Object.keys(result.metafile.inputs).some(key => key.endsWith(`/sdk/dist/tools/decode/index.${suffix}.js`)),
    `${condition} must select its dedicated decode artifact`
  )
}
const cjs = appRequire('@vultisig/sdk/tools/decode')
assert.equal(cjs.decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: evm }).amount, '123')
assert.equal(cjs.decode.fromToolResult, cjs.decodeFromToolResult)
const nodeEntry = path.join(appRoot, 'decode-node.mjs')
writeFileSync(
  nodeEntry,
  `import { decodeFromToolResult, decode } from '@vultisig/sdk/tools/decode'
if (decode.fromToolResult !== decodeFromToolResult || decodeFromToolResult({ family: 'evm', chain: 'ethereum', payload: ${JSON.stringify(evm)} }).amount !== '123') throw new Error('Node ESM decode import')`
)
execFileSync(process.execPath, [nodeEntry], { cwd: appRoot, stdio: 'inherit' })

const { transformSync } = await import(pathToFileURL(babelCore))
const nativeFile = path.join(appRoot, 'decode-react-native.js')
const transformed = transformSync(readFileSync(nativeFile, 'utf8'), {
  filename: nativeFile,
  configFile: false,
  babelrc: false,
  compact: false,
  presets: [[babelPreset, { enableBabelRuntime: false }]],
})
const hermesFile = path.join(appRoot, 'decode-hermes.js')
writeFileSync(hermesFile, transformed.code)
execFileSync(hermes, [hermesFile], { stdio: 'inherit' })

const { chromium } = await import(pathToFileURL(playwrightModule))
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><title>SDK decode smoke</title>')
  } else if (request.url === '/decode-browser.js' || request.url === '/decode-worker.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(readFileSync(path.join(appRoot, request.url.slice(1))))
  } else {
    response.writeHead(404)
    response.end()
  }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage()
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(origin)
  await page.addScriptTag({ url: `${origin}/decode-browser.js` })
  const pageResult = await page.evaluate(() => globalThis.decodeSmokeResult)
  assert.deepEqual(pageErrors, [])
  assert.ok(pageResult, 'browser decode script did not complete')
  const workerResult = await page.evaluate(
    origin =>
      new Promise((resolve, reject) => {
        const worker = new Worker(`${origin}/decode-worker.js`)
        const timeout = setTimeout(() => {
          worker.terminate()
          reject(new Error('decode worker timed out'))
        }, 15_000)
        worker.onmessage = event => {
          clearTimeout(timeout)
          worker.terminate()
          resolve(event.data)
        }
        worker.onerror = event => {
          clearTimeout(timeout)
          worker.terminate()
          reject(new Error(event.message))
        }
      }),
    origin
  )
  assert.deepEqual(workerResult, pageResult)
  console.log(
    JSON.stringify({
      chrome: await browser.version(),
      packageManifestSha256: archiveIdentity,
      node: true,
      hermes: true,
      browser: pageResult,
      worker: workerResult,
    })
  )
} finally {
  await browser?.close()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
