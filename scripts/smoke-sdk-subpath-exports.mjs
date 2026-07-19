import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vultisig-sdk-subpaths-'))
const appRoot = path.join(tempRoot, 'app')
const tarballPath = path.join(tempRoot, 'vultisig-sdk.tgz')

const run = (command, args, cwd = repoRoot) => {
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })
}

try {
  run('yarn', ['workspace', '@vultisig/sdk', 'pack', '--out', tarballPath])

  mkdirSync(appRoot, { recursive: true })
  writeFileSync(
    path.join(appRoot, 'package.json'),
    JSON.stringify({ name: 'sdk-subpath-smoke', private: true, type: 'module' }, null, 2) + '\n'
  )
  writeFileSync(
    path.join(appRoot, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ['smoke-types.ts'],
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(
    path.join(appRoot, 'smoke-runtime.mjs'),
    [
      "import assert from 'node:assert/strict'",
      "import { createRequire } from 'node:module'",
      '',
      'const require = createRequire(import.meta.url)',
      "const parsePath = require.resolve('@vultisig/sdk/tools/parse')",
      "const defiPath = require.resolve('@vultisig/sdk/tools/defi')",
      "const bridgePath = require.resolve('@vultisig/sdk/tools/bridge')",
      "const decodePath = require.resolve('@vultisig/sdk/tools/decode')",
      "const txPath = require.resolve('@vultisig/sdk/tx')",
      "const tonPath = require.resolve('@vultisig/sdk/chains/ton')",
      'assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)',
      'assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)',
      'assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)',
      'assert.match(decodePath, /dist\\/tools\\/decode\\/index\\.cjs$/)',
      'assert.match(txPath, /dist\\/tx\\/index\\.cjs$/)',
      'assert.match(tonPath, /dist\\/chains\\/ton\\/index\\.cjs$/)',
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const bridgeModule = await import('@vultisig/sdk/tools/bridge')",
      "const decodeModule = await import('@vultisig/sdk/tools/decode')",
      "const txModule = await import('@vultisig/sdk/tx')",
      "const tonModule = await import('@vultisig/sdk/chains/ton')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof bridgeModule.buildCctpBridge, 'function')",
      "assert.equal(typeof bridgeModule.getCctpChain, 'function')",
      "assert.equal(typeof decodeModule.decodeFromToolResult, 'function')",
      "assert.equal(typeof txModule.normalizeTx, 'function')",
      "assert.equal(txModule.normalizeTx({ to: '0x1', chain: 'Ethereum' }).chain, 'Ethereum')",
      "assert.equal(typeof tonModule.buildTonSendTx, 'function')",
      "assert.equal(typeof tonModule.deriveTonAddress, 'function')",
      "assert.equal(typeof tonModule.buildV4R2Wallet, 'function')",
      'console.log(JSON.stringify({ parsePath, defiPath, bridgePath, decodePath, txPath, tonPath, parseOk: true, defiOk: true, bridgeOk: true, decodeOk: true, txOk: true, tonOk: true }))',
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { buildCctpBridge, type CctpChainConfig } from '@vultisig/sdk/tools/bridge'",
      "import { decodeFromToolResult, type Envelope } from '@vultisig/sdk/tools/decode'",
      "import { normalizeTx, type NormalizedTx } from '@vultisig/sdk/tx'",
      "import { buildTonSendTx, type BuildTonSendOptions } from '@vultisig/sdk/chains/ton'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const builder: typeof buildCctpBridge = buildCctpBridge',
      'void builder',
      'const chainConfig = null as unknown as CctpChainConfig',
      'void chainConfig',
      "const decoded: Envelope = decodeFromToolResult({ chain: 'ethereum', payload: '0xabcd' })",
      'void decoded',
      "const normalized: NormalizedTx = normalizeTx({ to: '0x1', chain: 'Ethereum' })",
      'void normalized',
      'const buildTonSend: typeof buildTonSendTx = buildTonSendTx',
      'void buildTonSend',
      'const tonOptions = {} as BuildTonSendOptions',
      'void tonOptions',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
