import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { smokePrepConsumers } from './smoke-sdk-prep-consumers.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'vultisig-sdk-subpath-migration-'))
const appRoot = path.join(tempRoot, 'app')
const tarballPath = path.join(tempRoot, 'vultisig-sdk.tgz')
const run = (command, args, cwd = repoRoot) => execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env })

try {
  run('yarn', ['workspace', '@vultisig/sdk', 'pack', '--out', tarballPath])
  mkdirSync(appRoot, { recursive: true })
  writeFileSync(
    path.join(appRoot, 'package.json'),
    JSON.stringify({ name: 'sdk-subpath-migration-smoke', private: true, type: 'module' }) + '\n'
  )
  run('npm', ['install', '--no-package-lock', tarballPath], appRoot)

  writeFileSync(
    path.join(appRoot, 'smoke-runtime.mjs'),
    `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const expected = ['.', './node', './browser', './react-native', './rn-preamble', './electron', './electron/main', './chrome-extension', './vite', './tools/defi']
const manifest = JSON.parse(readFileSync(path.join(path.dirname(require.resolve('@vultisig/sdk')), '..', 'package.json'), 'utf8'))
assert.deepEqual(Object.keys(manifest.exports), expected)
for (const root of [await import('@vultisig/sdk'), require('@vultisig/sdk')]) {
  assert.equal(typeof root.parseChain, 'function')
  assert.equal(typeof root.getWalletCore, 'function')
  assert.equal(typeof root.chainTron.buildTronSendTx, 'function')
  assert.equal(typeof root.chainTron.getTronBlockRefs, 'function')
  assert.equal(typeof root.chainUtxo.buildUtxoSendTx, 'function')
  assert.equal(typeof root.chainUtxo.getSighashLegacy, 'function')
  assert.equal(typeof root.chainTon.buildTonSendTx, 'function')
  assert.equal(root.seedphrase.normalizeMnemonic('  ABANDON\\nABANDON  '), 'abandon abandon')
  assert.equal(typeof root.seedphrase.ChainDiscoveryService, 'function')
  assert.equal(typeof root.server.sendMpcRelayMessage, 'function')
  assert.equal(typeof root.balance.formatBalance, 'function')
  assert.equal(root.swap.MAX_PRICE_IMPACT_PCT, 10)
  const impactError = new root.swap.PriceImpactTooHighError(12)
  assert.equal(impactError.name, 'PriceImpactTooHighError')
  assert.equal(impactError.impactPercent, 12)
  assert.equal(typeof root.cosmos.gov.prepareCosmosVote, 'function')
  assert.equal(root.canonicalizeSignableTransactionValue({ z: 2, a: [1, 'x'] }), '{"a":[1,"x"],"z":2}')
  assert.equal(typeof root.buildCctpBridge, 'function')
  assert.equal(root.encodeErc20Approve('0x1111111111111111111111111111111111111111', 1n), '0x095ea7b3' + '0'.repeat(24) + '1'.repeat(40) + '0'.repeat(63) + '1')
  const policyClaim = { chain: 'base', recipient: '0xAAA', asset: 'USDC', amount: '1', amountUnits: 'human' }
  const policyEnvelope = { decoded: true, chainId: 'base', recipient: '0xBBB', asset: { symbol: 'USDC', decimals: 6 }, amount: 1000000n }
  const policyVerdict = root.policy.evaluate(policyClaim, policyEnvelope)
  assert.equal(policyVerdict.result, 'BLOCK')
  assert.equal(policyVerdict.diff[0].field, 'recipient')
  assert.equal(root.policy.checkInvariants({ claim: policyClaim, envelope: policyEnvelope })[0].invariant, 'I1_recipient_matches_intent')
}
for (const subpath of ${JSON.stringify(['tools/prep', 'seedphrase', 'tools/balance', 'tools/swap', 'tools/decode', 'tx', 'chains/tron', 'chains/utxo', 'chains/ton', 'abi', 'tools/parse', 'tools/policy', 'tools/price', 'tools/gas', 'tools/bridge', 'tools/evm', 'tools/cosmos', 'signable-transaction', 'server'])}) {
  const specifier = '@vultisig/sdk/' + subpath
  assert.throws(() => require.resolve(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
  await assert.rejects(import(specifier), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' })
}
assert.equal(typeof (await import('@vultisig/sdk/tools/defi')).defi, 'object')
assert.equal(typeof require('@vultisig/sdk/tools/defi').defi, 'object')
console.log('SDK packed root replacements and removed path rejection: PASS')
`
  )
  run('node', ['smoke-runtime.mjs'], appRoot)
  await smokePrepConsumers({ appRoot, repoRoot })

  writeFileSync(
    path.join(appRoot, 'smoke-types.ts'),
    `
import { balance, chainTon, chainTron, chainUtxo, cosmos, getWalletCore, seedphrase, server, swap } from '@vultisig/sdk'
import type { CosmosVoteEnvelope } from '@vultisig/sdk'
const tronBuilder: typeof chainTron.buildTronSendTx = chainTron.buildTronSendTx
const utxoBuilder: typeof chainUtxo.buildUtxoSendTx = chainUtxo.buildUtxoSendTx
const tonBuilder: typeof chainTon.buildTonSendTx = chainTon.buildTonSendTx
const mnemonic: string = seedphrase.normalizeMnemonic(' abandon ')
const relay: typeof server.sendMpcRelayMessage = server.sendMpcRelayMessage
const format: typeof balance.formatBalance = balance.formatBalance
const walletCore: typeof getWalletCore = getWalletCore
const impact: number = swap.MAX_PRICE_IMPACT_PCT
const vote: typeof cosmos.gov.prepareCosmosVote = cosmos.gov.prepareCosmosVote
const discovery = null as unknown as seedphrase.ChainDiscoveryAggregate
const envelope = null as unknown as CosmosVoteEnvelope
void [tronBuilder, utxoBuilder, tonBuilder, mnemonic, relay, format, walletCore, impact, vote, discovery, envelope]
`
  )
  for (const condition of [null, 'browser', 'react-native']) {
    writeFileSync(
      path.join(appRoot, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          ...(condition ? { customConditions: [condition] } : {}),
        },
        files: ['smoke-types.ts'],
      })
    )
    run(path.join(repoRoot, 'node_modules/.bin/tsc'), ['--project', 'tsconfig.json'], appRoot)
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
