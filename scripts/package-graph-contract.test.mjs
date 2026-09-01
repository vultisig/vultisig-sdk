import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve(import.meta.dirname, '..')
const readJson = relativePath => JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8'))

const skippedSourceDirectories = new Set(['dist', 'node_modules'])
const walkSourceFiles = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return skippedSourceDirectories.has(entry.name) ? [] : walkSourceFiles(entryPath)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryPath] : []
  })

test('published SDK packages declare an acyclic package graph', () => {
  const manifests = {
    '@vultisig/mpc-types': readJson('packages/mpc-types/package.json'),
    '@vultisig/core-chain': readJson('packages/core/chain/package.json'),
    '@vultisig/core-mpc': readJson('packages/core/mpc/package.json'),
    '@vultisig/sdk': readJson('packages/sdk/package.json'),
  }
  const packageNames = new Set(Object.keys(manifests))
  const graph = Object.fromEntries(
    Object.entries(manifests).map(([name, manifest]) => [
      name,
      Object.keys(manifest.dependencies ?? {}).filter(dependency => packageNames.has(dependency)),
    ])
  )

  assert.deepEqual([...graph['@vultisig/mpc-types']].sort(), [])
  assert.deepEqual([...graph['@vultisig/core-chain']].sort(), ['@vultisig/mpc-types'])
  assert.deepEqual([...graph['@vultisig/core-mpc']].sort(), ['@vultisig/core-chain', '@vultisig/mpc-types'])
  assert.deepEqual([...graph['@vultisig/sdk']].sort(), [
    '@vultisig/core-chain',
    '@vultisig/core-mpc',
    '@vultisig/mpc-types',
  ])

  const visited = new Set()
  const active = new Set()
  const visit = name => {
    assert.ok(!active.has(name), `package dependency cycle reaches ${name}`)
    if (visited.has(name)) return
    active.add(name)
    for (const dependency of graph[name]) visit(dependency)
    active.delete(name)
    visited.add(name)
  }
  for (const name of Object.keys(graph)) visit(name)
})

test('core-chain consumes shared signing schemas without importing core-mpc', () => {
  const coreChainRoot = path.join(repoRoot, 'packages/core/chain')
  const forbiddenImports = walkSourceFiles(coreChainRoot).filter(file =>
    readFileSync(file, 'utf8').includes('@vultisig/core-mpc')
  )
  assert.deepEqual(forbiddenImports, [])

  const builder = readFileSync(path.join(coreChainRoot, 'chains/utxo/tx/buildSignBitcoinFromPsbt.ts'), 'utf8')
  assert.match(builder, /from '@vultisig\/mpc-types\/types\/vultisig\/keysign\/v1\/wasm_execute_contract_payload_pb'/)

  const compatibilityExport = readFileSync(
    path.join(repoRoot, 'packages/core/mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb.ts'),
    'utf8'
  )
  assert.match(
    compatibilityExport,
    /export \* from ["']@vultisig\/mpc-types\/types\/vultisig\/keysign\/v1\/wasm_execute_contract_payload_pb["'];?/
  )
})

test('SDK TypeScript and declaration builds resolve core packages through exports', () => {
  const tsconfig = readJson('packages/sdk/tsconfig.json')
  assert.equal(tsconfig.compilerOptions.paths['@vultisig/core-chain/*'], undefined)
  assert.equal(tsconfig.compilerOptions.paths['@vultisig/core-mpc/*'], undefined)
  assert.ok(tsconfig.include.every(entry => !entry.startsWith('../core/')))

  const declarationsConfig = readJson('packages/sdk/tsconfig.declarations.json')
  assert.equal(declarationsConfig.compilerOptions.paths['@vultisig/core-chain/*'], undefined)
  assert.equal(declarationsConfig.compilerOptions.paths['@vultisig/core-mpc/*'], undefined)

  const typesConfig = readFileSync(path.join(repoRoot, 'packages/sdk/rollup.types.config.js'), 'utf8')
  assert.doesNotMatch(typesConfig, /'@vultisig\/core-(?:chain|mpc)\/\*': \['\.\.\/core\//)

  const runtimeConfig = readFileSync(path.join(repoRoot, 'packages/sdk/rollup.platforms.config.js'), 'utf8')
  assert.doesNotMatch(runtimeConfig, /find: \/\^@vultisig\\\/core-(?:chain|mpc)\\\/\(\.\*\)\//)
})
