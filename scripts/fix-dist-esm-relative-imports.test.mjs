import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { fixSource, resolveRelativeSpec } from './fix-dist-esm-relative-imports.mjs'

/**
 * Builds a throw-away `dist`-shaped directory on disk so `resolveRelativeSpec`
 * has something to probe. Returns the absolute path of the importing file we
 * hand to `fixSource`; all specifiers in the source are resolved relative to
 * that file, exactly like the real rewriter does when walking a package.
 */
function scaffold(layout) {
  const root = mkdtempSync(path.join(tmpdir(), 'fix-dist-esm-'))
  for (const rel of layout) {
    const abs = path.join(root, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, '')
  }
  return {
    root,
    from: path.join(root, 'entry.js'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('resolveRelativeSpec: flat file', () => {
  const { from, cleanup } = scaffold(['foo.js'])
  try {
    assert.equal(resolveRelativeSpec(from, './foo'), './foo.js')
  } finally {
    cleanup()
  }
})

test('resolveRelativeSpec: directory module', () => {
  const { from, cleanup } = scaffold(['foo/index.js'])
  try {
    assert.equal(resolveRelativeSpec(from, './foo'), './foo/index.js')
    assert.equal(resolveRelativeSpec(from, './foo/'), './foo/index.js')
  } finally {
    cleanup()
  }
})

test('resolveRelativeSpec: bare "." / ".."', () => {
  const { from, cleanup } = scaffold(['index.js', '../sibling/index.js'])
  try {
    assert.equal(resolveRelativeSpec(from, '.'), './index.js')
    // `..` probes the parent of `entry.js`; entry is at `<root>/entry.js`, so
    // `..` points at the tmp prefix where we put no `index.js` — expect no rewrite.
    assert.equal(resolveRelativeSpec(from, '..'), null)
  } finally {
    cleanup()
  }
})

test('resolveRelativeSpec: leaves missing targets alone', () => {
  const { from, cleanup } = scaffold(['present.js'])
  try {
    assert.equal(resolveRelativeSpec(from, './missing'), null)
    assert.equal(resolveRelativeSpec(from, './already.js'), null)
  } finally {
    cleanup()
  }
})

test('resolveRelativeSpec: ignores bare specifiers', () => {
  const { from, cleanup } = scaffold(['foo.js'])
  try {
    assert.equal(resolveRelativeSpec(from, 'some-pkg'), null)
    assert.equal(resolveRelativeSpec(from, '@scope/pkg'), null)
  } finally {
    cleanup()
  }
})

test('fixSource: static import, named, default, namespace', () => {
  const { from, cleanup } = scaffold(['a.js', 'b/index.js', 'c.js'])
  try {
    const input = [
      `import a from './a'`,
      `import { x } from './b'`,
      `import * as c from './c'`,
    ].join('\n')
    const expected = [
      `import a from './a.js'`,
      `import { x } from './b/index.js'`,
      `import * as c from './c.js'`,
    ].join('\n')
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: multi-line named list', () => {
  const { from, cleanup } = scaffold(['util/index.js'])
  try {
    const input = `import {\n  a,\n  b,\n} from './util'`
    const expected = `import {\n  a,\n  b,\n} from './util/index.js'`
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: re-export shapes', () => {
  const { from, cleanup } = scaffold(['a.js', 'b/index.js', 'c/index.js'])
  try {
    const input = [
      `export * from './a'`,
      `export * as ns from './b'`,
      `export {\n  x,\n  y,\n} from './c'`,
    ].join('\n')
    const expected = [
      `export * from './a.js'`,
      `export * as ns from './b/index.js'`,
      `export {\n  x,\n  y,\n} from './c/index.js'`,
    ].join('\n')
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: dynamic import with and without options', () => {
  const { from, cleanup } = scaffold(['a.json', 'b.js'])
  try {
    const input = [
      `const a = await import('./a.json', { with: { type: 'json' } })`,
      `const b = await import('./b')`,
    ].join('\n')
    const expected = [
      // Extension present → untouched.
      `const a = await import('./a.json', { with: { type: 'json' } })`,
      `const b = await import('./b.js')`,
    ].join('\n')
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: side-effect import', () => {
  const { from, cleanup } = scaffold(['polyfill.js', 'setup/index.js'])
  try {
    const input = [`import './polyfill'`, `import './setup'`].join('\n')
    const expected = [
      `import './polyfill.js'`,
      `import './setup/index.js'`,
    ].join('\n')
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: leaves import.meta and bare imports alone', () => {
  const { from, cleanup } = scaffold(['x.js'])
  try {
    const input = [
      `const url = import.meta.url`,
      `import pkg from 'some-pkg'`,
      `import { y } from '@scope/pkg'`,
      `import local from './x'`,
    ].join('\n')
    const expected = [
      `const url = import.meta.url`,
      `import pkg from 'some-pkg'`,
      `import { y } from '@scope/pkg'`,
      `import local from './x.js'`,
    ].join('\n')
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})

test('fixSource: preserves quote style', () => {
  const { from, cleanup } = scaffold(['a.js', 'b.js'])
  try {
    const input = `import "./a"; import './b'`
    const expected = `import "./a.js"; import './b.js'`
    assert.equal(fixSource(from, input), expected)
  } finally {
    cleanup()
  }
})
