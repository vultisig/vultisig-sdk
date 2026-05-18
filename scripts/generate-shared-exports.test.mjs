import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  applySharedExports,
  checkSharedExports,
  diffSharedExports,
  generateSharedExports,
  hasSharedExportDiff,
} from './generate-shared-exports.mjs'

function scaffold(files, pkg = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'shared-exports-'))
  const dist = path.join(root, 'dist')
  const packageJson = path.join(root, 'package.json')

  for (const rel of files) {
    const abs = path.join(dist, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, '')
  }

  writeFileSync(packageJson, `${JSON.stringify({ name: '@test/shared', type: 'module', ...pkg }, null, 2)}\n`)

  return {
    root,
    dist,
    packageJson,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('generateSharedExports maps flat, directory, and package.json exports', () => {
  const { dist, cleanup } = scaffold(['index.js', 'foo.js', 'bar/index.js'])
  try {
    assert.deepEqual(generateSharedExports(dist), {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      },
      './bar': {
        types: './dist/bar/index.d.ts',
        import: './dist/bar/index.js',
        default: './dist/bar/index.js',
      },
      './foo': {
        types: './dist/foo.d.ts',
        import: './dist/foo.js',
        default: './dist/foo.js',
      },
      './package.json': './package.json',
    })
  } finally {
    cleanup()
  }
})

test('generateSharedExports collapses getSevenZip platform entries', () => {
  const { dist, cleanup } = scaffold([
    'compression/getSevenZip.js',
    'compression/getSevenZip.browser.js',
    'compression/getSevenZip.node.js',
  ])
  try {
    assert.deepEqual(generateSharedExports(dist), {
      './compression/getSevenZip': {
        types: './dist/compression/getSevenZip.d.ts',
        browser: './dist/compression/getSevenZip.browser.js',
        node: './dist/compression/getSevenZip.node.js',
        import: './dist/compression/getSevenZip.js',
        default: './dist/compression/getSevenZip.js',
      },
      './package.json': './package.json',
    })
  } finally {
    cleanup()
  }
})

test('diffSharedExports reports missing, extra, and mismatched subpaths', () => {
  const { dist, packageJson, cleanup } = scaffold(['index.js', 'foo.js'], {
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/wrong.js',
        default: './dist/index.js',
      },
      './old': './dist/old.js',
      './package.json': './package.json',
    },
  })

  try {
    const diff = diffSharedExports(packageJson, dist)

    assert.deepEqual(diff.missing, ['./foo'])
    assert.deepEqual(diff.extra, ['./old'])
    assert.deepEqual(diff.mismatched, [
      {
        key: '.',
        actual: {
          types: './dist/index.d.ts',
          import: './dist/wrong.js',
          default: './dist/index.js',
        },
        expected: {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
      },
    ])
    assert.equal(hasSharedExportDiff(diff), true)
  } finally {
    cleanup()
  }
})

test('checkSharedExports fails actionably without rewriting package.json', () => {
  const { dist, packageJson, cleanup } = scaffold(['index.js'], {
    exports: {
      './stale': './dist/stale.js',
    },
  })
  const before = readFileSync(packageJson, 'utf8')

  try {
    assert.throws(
      () => checkSharedExports(packageJson, dist, { relativeTo: path.dirname(packageJson) }),
      error => {
        assert.match(error.message, /package\.json has stale generated exports/)
        assert.match(error.message, /Run `yarn build:shared`/)
        assert.match(error.message, /Missing exports:\n  \+ \./)
        assert.match(error.message, /Extra exports:\n  - \.\/stale/)
        return true
      }
    )
    assert.equal(readFileSync(packageJson, 'utf8'), before)
  } finally {
    cleanup()
  }
})

test('applySharedExports rewrites package.json when regeneration is requested', () => {
  const { dist, packageJson, cleanup } = scaffold(['index.js'], {
    exports: {
      './stale': './dist/stale.js',
    },
  })

  try {
    applySharedExports(packageJson, dist)
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8'))

    assert.deepEqual(Object.keys(pkg.exports), ['.', './package.json'])
  } finally {
    cleanup()
  }
})
