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
      "const bridgePath = require.resolve('@vultisig/sdk/tools/bridge')",
      "const gasPath = require.resolve('@vultisig/sdk/tools/gas')",
      "const policyPath = require.resolve('@vultisig/sdk/tools/policy')",
      "const swapPath = require.resolve('@vultisig/sdk/tools/swap')",
      "const prepPath = require.resolve('@vultisig/sdk/tools/prep')",
      "assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)",
      "assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)",
      "assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)",
      "assert.match(gasPath, /dist\\/tools\\/gas\\/index\\.cjs$/)",
      "assert.match(policyPath, /dist\\/tools\\/policy\\/index\\.cjs$/)",
      "assert.match(swapPath, /dist\\/tools\\/swap\\/index\\.cjs$/)",
      "assert.match(prepPath, /dist\\/tools\\/prep\\/index\\.cjs$/)",
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const bridge = await import('@vultisig/sdk/tools/bridge')",
      "const gas = await import('@vultisig/sdk/tools/gas')",
      "const policyModule = await import('@vultisig/sdk/tools/policy')",
      "const swap = await import('@vultisig/sdk/tools/swap')",
      "const prep = await import('@vultisig/sdk/tools/prep')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof bridge.buildCctpBridge, 'function')",
      "assert.equal(typeof gas.utxoFeeRate, 'function')",
      "assert.equal(typeof policyModule.policy.evaluate, 'function')",
      "assert.equal(typeof swap.buildJupiterSwapTx, 'function')",
      'assert.equal(swap.MAX_PRICE_IMPACT_PCT, 10)',
      "assert.equal(swap.PriceImpactTooHighError.name, 'PriceImpactTooHighError')",
      "assert.equal(typeof prep.prepareSendTxFromKeys, 'function')",
      "assert.equal(typeof prep.prepareIbcTransfer, 'function')",
      'console.log(JSON.stringify({ parsePath, defiPath, bridgePath, gasPath, policyPath, swapPath, prepPath, parseOk: true, defiOk: true, bridgeOk: true, gasOk: true, policyOk: true, swapOk: true, prepOk: true }))',
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { buildCctpBridge, type BuildCctpBridgeParams } from '@vultisig/sdk/tools/bridge'",
      "import { utxoFeeRate, type UtxoFeeRate } from '@vultisig/sdk/tools/gas'",
      "import { policy, type Verdict } from '@vultisig/sdk/tools/policy'",
      "import { MAX_PRICE_IMPACT_PCT, PriceImpactTooHighError, type SwapQuote } from '@vultisig/sdk/tools/swap'",
      "import { prepareIbcTransfer, prepareSendTxFromKeys, type PrepareSendTxFromKeysParams } from '@vultisig/sdk/tools/prep'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const bridgeBuilder: typeof buildCctpBridge = buildCctpBridge',
      'void bridgeBuilder',
      'const bridgeParams = null as unknown as BuildCctpBridgeParams',
      'void bridgeParams',
      'const gasHelper: typeof utxoFeeRate = utxoFeeRate',
      'void gasHelper',
      'const utxoRate = null as unknown as UtxoFeeRate',
      'void utxoRate',
      'const policyEvaluate: typeof policy.evaluate = policy.evaluate',
      'void policyEvaluate',
      'const verdict = null as unknown as Verdict',
      'void verdict',
      'const maxImpact: number = MAX_PRICE_IMPACT_PCT',
      'void maxImpact',
      'const errorCtor: typeof PriceImpactTooHighError = PriceImpactTooHighError',
      'void errorCtor',
      'const maybeQuote: SwapQuote | null = null',
      'void maybeQuote',
      'void prepareIbcTransfer',
      'void prepareSendTxFromKeys',
      'type _PrepParams = PrepareSendTxFromKeysParams',
      'void (0 as unknown as _PrepParams)',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
