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
      "const require = createRequire(import.meta.url)",
      "const parsePath = require.resolve('@vultisig/sdk/tools/parse')",
      "const defiPath = require.resolve('@vultisig/sdk/tools/defi')",
      "const policyPath = require.resolve('@vultisig/sdk/tools/policy')",
      "const bridgePath = require.resolve('@vultisig/sdk/tools/bridge')",
      "const gasPath = require.resolve('@vultisig/sdk/tools/gas')",
      "assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)",
      "assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)",
      "assert.match(policyPath, /dist\\/tools\\/policy\\/index\\.cjs$/)",
      "assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)",
      "assert.match(gasPath, /dist\\/tools\\/gas\\/index\\.cjs$/)",
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const policyModule = await import('@vultisig/sdk/tools/policy')",
      "const bridgeModule = await import('@vultisig/sdk/tools/bridge')",
      "const gasModule = await import('@vultisig/sdk/tools/gas')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof policyModule.policy.evaluate, 'function')",
      "assert.equal(typeof bridgeModule.buildCctpBridge, 'function')",
      "assert.equal(typeof gasModule.utxoFeeRate, 'function')",
      "console.log(JSON.stringify({ parsePath, defiPath, policyPath, bridgePath, gasPath, parseOk: true, defiOk: true, policyOk: true, bridgeOk: true, gasOk: true }))",
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { policy, type Verdict } from '@vultisig/sdk/tools/policy'",
      "import { buildCctpBridge, type BuildCctpBridgeParams } from '@vultisig/sdk/tools/bridge'",
      "import { utxoFeeRate, type UtxoFeeRate } from '@vultisig/sdk/tools/gas'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      "const policyEvaluate: typeof policy.evaluate = policy.evaluate",
      'void policyEvaluate',
      "const bridgeBuilder: typeof buildCctpBridge = buildCctpBridge",
      'void bridgeBuilder',
      "const bridgeParams = null as unknown as BuildCctpBridgeParams",
      'void bridgeParams',
      "const gasHelper: typeof utxoFeeRate = utxoFeeRate",
      'void gasHelper',
      "const utxoRate = null as unknown as UtxoFeeRate",
      'void utxoRate',
      "const verdict = null as unknown as Verdict",
      'void verdict',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
