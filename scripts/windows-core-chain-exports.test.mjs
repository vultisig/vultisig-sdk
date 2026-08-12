import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = path.join(repoRoot, 'packages/core/chain')
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const windowsConsumerExports = [
  './chains/thorchain/ruji/services/fetchMergeableTokenBalances',
  './chains/thorchain/ruji/services/fetchStakeView',
]

test('core-chain retains the Rujira service subpaths consumed by Windows', () => {
  for (const subpath of windowsConsumerExports) {
    const contract = packageJson.exports?.[subpath]
    assert.ok(contract, `missing Windows consumer export: ${subpath}`)

    for (const condition of ['types', 'import', 'default']) {
      assert.equal(typeof contract[condition], 'string', `${subpath} is missing its ${condition} target`)
    }

    const sourcePath = path.join(packageRoot, `${subpath.slice('./'.length)}.ts`)
    assert.ok(existsSync(sourcePath), `missing Windows consumer source: ${sourcePath}`)
  }
})
