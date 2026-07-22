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
      "const tronPath = require.resolve('@vultisig/sdk/chains/tron')",
      "const utxoPath = require.resolve('@vultisig/sdk/chains/utxo')",
      "assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)",
      "assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)",
      "assert.match(tronPath, /dist\\/chains\\/tron\\/index\\.cjs$/)",
      "assert.match(utxoPath, /dist\\/chains\\/utxo\\/index\\.cjs$/)",
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const tron = await import('@vultisig/sdk/chains/tron')",
      "const utxo = await import('@vultisig/sdk/chains/utxo')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof tron.buildTronSendTx, 'function')",
      "assert.equal(typeof tron.getTronBlockRefs, 'function')",
      "assert.equal(typeof utxo.buildUtxoSendTx, 'function')",
      "assert.equal(typeof utxo.getZcashBranchIdHex, 'function')",
      "console.log(JSON.stringify({ parsePath, defiPath, tronPath, utxoPath, parseOk: true, defiOk: true, tronOk: true, utxoOk: true }))",
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { buildTronSendTx, type BuildTronSendOptions } from '@vultisig/sdk/chains/tron'",
      "import { buildUtxoSendTx, type BuildUtxoSendOptions } from '@vultisig/sdk/chains/utxo'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const tronBuilder: typeof buildTronSendTx = buildTronSendTx',
      'void tronBuilder',
      'const tronOptionsTypeCheck = null as unknown as BuildTronSendOptions',
      'void tronOptionsTypeCheck',
      'const utxoBuilder: typeof buildUtxoSendTx = buildUtxoSendTx',
      'void utxoBuilder',
      'const utxoOptionsTypeCheck = null as unknown as BuildUtxoSendOptions',
      'void utxoOptionsTypeCheck',
      '',
    ].join('\n')
  )

  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)
  run('node', ['smoke-runtime.mjs'], appRoot)
  run('yarn', ['exec', 'tsc', '--project', path.join(appRoot, 'tsconfig.json')], repoRoot)
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
