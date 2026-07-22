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
      "const swapPath = require.resolve('@vultisig/sdk/tools/swap')",
      "assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)",
      "assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)",
      "assert.match(swapPath, /dist\\/tools\\/swap\\/index\\.cjs$/)",
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const swap = await import('@vultisig/sdk/tools/swap')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof swap.buildJupiterSwapTx, 'function')",
      "assert.equal(swap.MAX_PRICE_IMPACT_PCT, 10)",
      "assert.equal(swap.PriceImpactTooHighError.name, 'PriceImpactTooHighError')",
      "console.log(JSON.stringify({ parsePath, defiPath, swapPath, parseOk: true, defiOk: true, swapOk: true }))",
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { MAX_PRICE_IMPACT_PCT, PriceImpactTooHighError, type SwapQuote } from '@vultisig/sdk/tools/swap'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const maxImpact: number = MAX_PRICE_IMPACT_PCT',
      'void maxImpact',
      'const errorCtor: typeof PriceImpactTooHighError = PriceImpactTooHighError',
      'void errorCtor',
      'const maybeQuote: SwapQuote | null = null',
      'void maybeQuote',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
