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
      "const gasPath = require.resolve('@vultisig/sdk/tools/gas')",
      "const balancePath = require.resolve('@vultisig/sdk/tools/balance')",
      "const tronPath = require.resolve('@vultisig/sdk/chains/tron')",
      "const utxoPath = require.resolve('@vultisig/sdk/chains/utxo')",
      "const decodePath = require.resolve('@vultisig/sdk/tools/decode')",
      "const prepPath = require.resolve('@vultisig/sdk/tools/prep')",
      "const txPath = require.resolve('@vultisig/sdk/tx')",
      'assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)',
      'assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)',
      'assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)',
      'assert.match(gasPath, /dist\\/tools\\/gas\\/index\\.cjs$/)',
      'assert.match(balancePath, /dist\\/tools\\/balance\\/index\\.cjs$/)',
      'assert.match(tronPath, /dist\\/chains\\/tron\\/index\\.cjs$/)',
      'assert.match(utxoPath, /dist\\/chains\\/utxo\\/index\\.cjs$/)',
      'assert.match(decodePath, /dist\\/tools\\/decode\\/index\\.cjs$/)',
      'assert.match(prepPath, /dist\\/tools\\/prep\\/index\\.cjs$/)',
      'assert.match(txPath, /dist\\/tx\\/index\\.cjs$/)',
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const bridgeModule = await import('@vultisig/sdk/tools/bridge')",
      "const gasModule = await import('@vultisig/sdk/tools/gas')",
      "const balanceModule = await import('@vultisig/sdk/tools/balance')",
      "const balanceCjs = require('@vultisig/sdk/tools/balance')",
      "const tron = await import('@vultisig/sdk/chains/tron')",
      "const utxo = await import('@vultisig/sdk/chains/utxo')",
      "const decodeModule = await import('@vultisig/sdk/tools/decode')",
      "const prepModule = await import('@vultisig/sdk/tools/prep')",
      "const txModule = await import('@vultisig/sdk/tx')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof bridgeModule.buildCctpBridge, 'function')",
      "assert.equal(typeof bridgeModule.getCctpChain, 'function')",
      "assert.equal(typeof gasModule.compareCosts, 'function')",
      "assert.equal(typeof gasModule.getChainGasPriceGwei, 'function')",
      "assert.equal(typeof balanceModule.getXrpBalance, 'function')",
      "assert.equal(typeof balanceModule.getUtxoBalance, 'function')",
      "assert.equal(typeof balanceCjs.getXrpBalance, 'function')",
      "assert.equal(typeof balanceCjs.getUtxoBalance, 'function')",
      "assert.equal(typeof tron.buildTronSendTx, 'function')",
      "assert.equal(typeof tron.getTronBlockRefs, 'function')",
      "assert.equal(typeof utxo.buildUtxoSendTx, 'function')",
      "assert.equal(typeof utxo.getSighashLegacy, 'function')",
      "assert.equal(typeof decodeModule.decodeFromToolResult, 'function')",
      "assert.equal(typeof prepModule.prepareSendTxFromKeys, 'function')",
      "assert.equal(typeof prepModule.buildDelegateMsg, 'function')",
      "assert.equal(prepModule.buildDelegateMsg({ delegatorAddress: 'osmo1runz6dpmgfy4q467v4k8x75p3z8ed8dyxqlpht', validatorAddress: 'osmovaloper18ez5c566v95x7anasj9e9xdq57htt0xrztjrg0', amount: '5000000', denom: 'uosmo' }).typeUrl, '/cosmos.staking.v1beta1.MsgDelegate')",
      "assert.equal(typeof txModule.normalizeTx, 'function')",
      "assert.equal(txModule.normalizeTx({ to: '0x1', chain: 'Ethereum' }).chain, 'Ethereum')",
      'console.log(JSON.stringify({ parsePath, defiPath, bridgePath, gasPath, balancePath, tronPath, utxoPath, decodePath, prepPath, txPath, parseOk: true, defiOk: true, bridgeOk: true, gasOk: true, balanceOk: true, tronOk: true, utxoOk: true, decodeOk: true, prepOk: true, txOk: true }))',
      '',
    ].join('\n')
  )
  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    [
      "import { parseChain, type ParseChainResult } from '@vultisig/sdk/tools/parse'",
      "import { defi, type Defi } from '@vultisig/sdk/tools/defi'",
      "import { UtxoChain } from '@vultisig/sdk'",
      "import { buildCctpBridge, type CctpChainConfig } from '@vultisig/sdk/tools/bridge'",
      "import { compareCosts, type CompareCostsParams } from '@vultisig/sdk/tools/gas'",
      "import { getUtxoBalance, getXrpBalance, type GetUtxoBalanceOptions, type UtxoBalance, type XrpBalance } from '@vultisig/sdk/tools/balance'",
      "import { buildTronSendTx, type BuildTronSendOptions } from '@vultisig/sdk/chains/tron'",
      "import { buildUtxoSendTx, type BuildUtxoSendOptions } from '@vultisig/sdk/chains/utxo'",
      "import { decodeFromToolResult, type Envelope } from '@vultisig/sdk/tools/decode'",
      "import { buildDelegateMsg, type DelegateParams, prepareSendTxFromKeys, type PrepareSendTxFromKeysParams } from '@vultisig/sdk/tools/prep'",
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
      'const costComparer: typeof compareCosts = compareCosts',
      'void costComparer',
      'const costParams = null as unknown as CompareCostsParams',
      'void costParams',
      'const balanceReader: (address: string) => Promise<XrpBalance> = getXrpBalance',
      'void balanceReader',
      'const utxoReader: (chain: UtxoChain, address: string, options?: GetUtxoBalanceOptions) => Promise<UtxoBalance> = getUtxoBalance',
      'void utxoReader',
      "const xrpBalance: XrpBalance = { address: 'rExample', balanceDrops: '1000000', balanceXrp: '1.000000', asOf: '2026-08-11T00:00:00Z' }",
      'void xrpBalance.balanceDrops',
      "const utxoBalance: UtxoBalance = { chain: UtxoChain.Bitcoin, address: 'bc1qexample', symbol: 'BTC', satoshis: '42', balance: '0.00000042' }",
      'void utxoBalance.satoshis',
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
      'const delegateBuilder: typeof buildDelegateMsg = buildDelegateMsg',
      'void delegateBuilder',
      'const delegateParams = {} as DelegateParams',
      'void delegateParams',
      'const sendPreparer: typeof prepareSendTxFromKeys = prepareSendTxFromKeys',
      'void sendPreparer',
      'const sendParams = {} as PrepareSendTxFromKeysParams',
      'void sendParams',
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
