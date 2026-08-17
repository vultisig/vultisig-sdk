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
      "const tronPath = require.resolve('@vultisig/sdk/chains/tron')",
      "const utxoPath = require.resolve('@vultisig/sdk/chains/utxo')",
      "const decodePath = require.resolve('@vultisig/sdk/tools/decode')",
      "const policyPath = require.resolve('@vultisig/sdk/tools/policy')",
      "const txPath = require.resolve('@vultisig/sdk/tx')",
      'assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)',
      'assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)',
      'assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)',
      'assert.match(tronPath, /dist\\/chains\\/tron\\/index\\.cjs$/)',
      'assert.match(utxoPath, /dist\\/chains\\/utxo\\/index\\.cjs$/)',
      'assert.match(decodePath, /dist\\/tools\\/decode\\/index\\.cjs$/)',
      'assert.match(policyPath, /dist\\/tools\\/policy\\/index\\.cjs$/)',
      'assert.match(txPath, /dist\\/tx\\/index\\.cjs$/)',
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const bridgeModule = await import('@vultisig/sdk/tools/bridge')",
      "const tron = await import('@vultisig/sdk/chains/tron')",
      "const utxo = await import('@vultisig/sdk/chains/utxo')",
      "const decodeModule = await import('@vultisig/sdk/tools/decode')",
      "const policyModule = await import('@vultisig/sdk/tools/policy')",
      "const txModule = await import('@vultisig/sdk/tx')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof bridgeModule.buildCctpBridge, 'function')",
      "assert.equal(typeof bridgeModule.getCctpChain, 'function')",
      "assert.equal(typeof tron.buildTronSendTx, 'function')",
      "assert.equal(typeof tron.getTronBlockRefs, 'function')",
      "assert.equal(typeof utxo.buildUtxoSendTx, 'function')",
      "assert.equal(typeof utxo.getSighashLegacy, 'function')",
      "assert.equal(typeof decodeModule.decodeFromToolResult, 'function')",
      "assert.equal(typeof policyModule.policy.evaluate, 'function')",
      "assert.equal(typeof policyModule.policy.checkInvariants, 'function')",
      "assert.equal(typeof txModule.normalizeTx, 'function')",
      "assert.equal(txModule.normalizeTx({ to: '0x1', chain: 'Ethereum' }).chain, 'Ethereum')",
      'console.log(JSON.stringify({ parsePath, defiPath, bridgePath, tronPath, utxoPath, decodePath, policyPath, txPath, parseOk: true, defiOk: true, bridgeOk: true, tronOk: true, utxoOk: true, decodeOk: true, policyOk: true, txOk: true }))',
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { buildCctpBridge, type CctpChainConfig } from '@vultisig/sdk/tools/bridge'",
      "import { buildTronSendTx, type BuildTronSendOptions } from '@vultisig/sdk/chains/tron'",
      "import { buildUtxoSendTx, type BuildUtxoSendOptions } from '@vultisig/sdk/chains/utxo'",
      "import { decodeFromToolResult, type Envelope } from '@vultisig/sdk/tools/decode'",
      "import { policy, type Verdict } from '@vultisig/sdk/tools/policy'",
      "import { normalizeTx, type NormalizedTx } from '@vultisig/sdk/tx'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const builder: typeof buildCctpBridge = buildCctpBridge',
      'void builder',
      'const chainConfig = null as unknown as CctpChainConfig',
      'void chainConfig',
      'const tronBuilder: typeof buildTronSendTx = buildTronSendTx',
      'void tronBuilder',
      'const tronOptions = {} as BuildTronSendOptions',
      'void tronOptions',
      'const utxoBuilder: typeof buildUtxoSendTx = buildUtxoSendTx',
      'void utxoBuilder',
      'const utxoOptions = {} as BuildUtxoSendOptions',
      'void utxoOptions',
      "const decoded: Envelope = decodeFromToolResult({ chain: 'ethereum', payload: '0xabcd' })",
      'void decoded',
      'const verdict: Verdict = policy.evaluate(',
      "  { chain: 'base', recipient: '0xAAA', asset: 'USDC', amount: '1', amountUnits: 'human' },",
      "  { decoded: true, chainId: 'base', recipient: '0xBBB', asset: { symbol: 'USDC', decimals: 6 }, amount: 1000000n }",
      ')',
      'void verdict',
      "const normalized: NormalizedTx = normalizeTx({ to: '0x1', chain: 'Ethereum' })",
      'void normalized',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
