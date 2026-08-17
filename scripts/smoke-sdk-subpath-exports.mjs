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
      "const balancePath = require.resolve('@vultisig/sdk/tools/balance')",
      "const tronPath = require.resolve('@vultisig/sdk/chains/tron')",
      "const utxoPath = require.resolve('@vultisig/sdk/chains/utxo')",
      "const decodePath = require.resolve('@vultisig/sdk/tools/decode')",
      "const txPath = require.resolve('@vultisig/sdk/tx')",
      "const dexPath = require.resolve('@vultisig/sdk/tools/dex')",
      "const addrPath = require.resolve('@vultisig/sdk/tools/address')",
      "const validatePath = require.resolve('@vultisig/sdk/tools/validate')",
      "const evmPath = require.resolve('@vultisig/sdk/tools/evm')",
      "const cosmosPath = require.resolve('@vultisig/sdk/tools/cosmos')",
      "const policyPath = require.resolve('@vultisig/sdk/tools/policy')",
      "const signablePath = require.resolve('@vultisig/sdk/signable-transaction')",
      'assert.match(parsePath, /dist\\/tools\\/parse\\/index\\.cjs$/)',
      'assert.match(defiPath, /dist\\/tools\\/defi\\/index\\.cjs$/)',
      'assert.match(bridgePath, /dist\\/tools\\/bridge\\/index\\.cjs$/)',
      'assert.match(balancePath, /dist\\/tools\\/balance\\/index\\.cjs$/)',
      'assert.match(tronPath, /dist\\/chains\\/tron\\/index\\.cjs$/)',
      'assert.match(utxoPath, /dist\\/chains\\/utxo\\/index\\.cjs$/)',
      'assert.match(decodePath, /dist\\/tools\\/decode\\/index\\.cjs$/)',
      'assert.match(txPath, /dist\\/tx\\/index\\.cjs$/)',
      'assert.match(dexPath, /dist\\/tools\\/dex\\/index\\.cjs$/)',
      'assert.match(addrPath, /dist\\/tools\\/address\\/index\\.cjs$/)',
      'assert.match(validatePath, /dist\\/tools\\/validate\\/index\\.cjs$/)',
      'assert.match(evmPath, /dist\\/tools\\/evm\\/index\\.cjs$/)',
      'assert.match(cosmosPath, /dist\\/tools\\/cosmos\\/index\\.cjs$/)',
      'assert.match(policyPath, /dist\\/tools\\/policy\\/index\\.cjs$/)',
      'assert.match(signablePath, /dist\\/signable-transaction\\/index\\.cjs$/)',
      "const parse = await import('@vultisig/sdk/tools/parse')",
      "const defiModule = await import('@vultisig/sdk/tools/defi')",
      "const bridgeModule = await import('@vultisig/sdk/tools/bridge')",
      "const balanceModule = await import('@vultisig/sdk/tools/balance')",
      "const balanceCjs = require('@vultisig/sdk/tools/balance')",
      "const tron = await import('@vultisig/sdk/chains/tron')",
      "const utxo = await import('@vultisig/sdk/chains/utxo')",
      "const decodeModule = await import('@vultisig/sdk/tools/decode')",
      "const txModule = await import('@vultisig/sdk/tx')",
      "const dexModule = await import('@vultisig/sdk/tools/dex')",
      "const addrModule = await import('@vultisig/sdk/tools/address')",
      "const validateModule = await import('@vultisig/sdk/tools/validate')",
      "const evmModule = await import('@vultisig/sdk/tools/evm')",
      "const cosmosModule = await import('@vultisig/sdk/tools/cosmos')",
      "const policyModule = await import('@vultisig/sdk/tools/policy')",
      "const signableModule = await import('@vultisig/sdk/signable-transaction')",
      "assert.equal(parse.parseChain('Ethereum').success, true)",
      "assert.equal(typeof parse.parseTicker, 'function')",
      "assert.equal(typeof defiModule.defi, 'object')",
      "assert.equal(typeof defiModule.osmosis.buildSwapExactAmountIn, 'function')",
      "assert.equal(typeof bridgeModule.buildCctpBridge, 'function')",
      "assert.equal(typeof bridgeModule.getCctpChain, 'function')",
      "assert.equal(typeof balanceModule.getXrpBalance, 'function')",
      "assert.equal(typeof balanceModule.getUtxoBalance, 'function')",
      "assert.equal(typeof balanceCjs.getXrpBalance, 'function')",
      "assert.equal(typeof balanceCjs.getUtxoBalance, 'function')",
      "assert.equal(typeof tron.buildTronSendTx, 'function')",
      "assert.equal(typeof tron.getTronBlockRefs, 'function')",
      "assert.equal(typeof utxo.buildUtxoSendTx, 'function')",
      "assert.equal(typeof utxo.getSighashLegacy, 'function')",
      "assert.equal(typeof decodeModule.decodeFromToolResult, 'function')",
      "assert.equal(typeof txModule.normalizeTx, 'function')",
      "assert.equal(txModule.normalizeTx({ to: '0x1', chain: 'Ethereum' }).chain, 'Ethereum')",
      "assert.equal(typeof dexModule.uniswapV2Quote, 'function')",
      "assert.equal(typeof addrModule.deriveAddressFromKeys, 'function')",
      "assert.equal(typeof validateModule.recipientSanity, 'function')",
      "assert.equal(typeof evmModule.encodeErc20Approve, 'function')",
      "assert.equal(typeof cosmosModule.prepareCosmosVote, 'function')",
      "assert.equal(typeof policyModule.checkInvariants, 'function')",
      "assert.equal(typeof signableModule.decodeSignableTransactionV1, 'function')",
      'console.log(JSON.stringify({ parsePath, defiPath, bridgePath, balancePath, tronPath, utxoPath, decodePath, txPath, dexPath, addrPath, validatePath, evmPath, cosmosPath, policyPath, signablePath, parseOk: true, defiOk: true, bridgeOk: true, balanceOk: true, tronOk: true, utxoOk: true, decodeOk: true, txOk: true, dexOk: true, addrOk: true, validateOk: true, evmOk: true, cosmosOk: true, policyOk: true, signableOk: true }))',
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
      "import { getUtxoBalance, getXrpBalance, type GetUtxoBalanceOptions, type UtxoBalance, type XrpBalance } from '@vultisig/sdk/tools/balance'",
      "import { buildTronSendTx, type BuildTronSendOptions } from '@vultisig/sdk/chains/tron'",
      "import { buildUtxoSendTx, type BuildUtxoSendOptions } from '@vultisig/sdk/chains/utxo'",
      "import { decodeFromToolResult, type Envelope } from '@vultisig/sdk/tools/decode'",
      "import { normalizeTx, type NormalizedTx } from '@vultisig/sdk/tx'",
      "import { uniswapV2Quote } from '@vultisig/sdk/tools/dex'",
      "import { deriveAddressFromKeys } from '@vultisig/sdk/tools/address'",
      "import { recipientSanity } from '@vultisig/sdk/tools/validate'",
      "import { encodeErc20Approve } from '@vultisig/sdk/tools/evm'",
      "import { prepareCosmosVote } from '@vultisig/sdk/tools/cosmos'",
      "import { checkInvariants } from '@vultisig/sdk/tools/policy'",
      "import { decodeSignableTransactionV1 } from '@vultisig/sdk/signable-transaction'",
      '',
      "const chainResult: ParseChainResult = parseChain('Ethereum')",
      'void chainResult',
      'const tools: Defi = defi',
      'void tools',
      'const builder: typeof buildCctpBridge = buildCctpBridge',
      'void builder',
      'const chainConfig = null as unknown as CctpChainConfig',
      'void chainConfig',
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
