import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateEagerGraphBytes, validateRollupEagerGraph } from './sdk-eager-graph.mjs'

const chunk = (fileName, code, imports = [], dynamicImports = [], isEntry = false) => ({
  type: 'chunk',
  fileName,
  code,
  imports,
  dynamicImports,
  isEntry,
})

test('counts complete eager chunks while excluding deferred chunks', () => {
  const bundle = {
    'index.cjs': chunk('index.cjs', 'entry', ['shared.cjs'], ['lazy.cjs'], true),
    'shared.cjs': chunk('shared.cjs', 'shared', [], ['lazy.cjs']),
    'lazy.cjs': chunk('lazy.cjs', 'deferred code'),
  }
  assert.deepEqual(validateRollupEagerGraph(bundle, 12), [{ entry: 'index.cjs', bytes: 11, files: 2 }])
  assert.throws(() => validateRollupEagerGraph(bundle, 11), /eager graph/)
})

test('checks every emitted entry independently', () => {
  const bundle = {
    'a.js': chunk('a.js', 'a', ['shared.js'], [], true),
    'b.js': chunk('b.js', 'bb', ['shared.js'], [], true),
    'shared.js': chunk('shared.js', 'shared'),
  }
  assert.deepEqual(validateRollupEagerGraph(bundle, 10), [
    { entry: 'a.js', bytes: 7, files: 2 },
    { entry: 'b.js', bytes: 8, files: 2 },
  ])
  assert.throws(() => validateRollupEagerGraph(bundle, 8), /b\.js eager graph/)
})

test('rejects React Native startup when root and required preamble exceed the cap together', () => {
  validateEagerGraphBytes('React Native with preamble', 3_999_999, 4_000_000)
  assert.throws(
    () => validateEagerGraphBytes('React Native with preamble', 4_000_000, 4_000_000),
    /React Native with preamble eager graph/
  )
})
