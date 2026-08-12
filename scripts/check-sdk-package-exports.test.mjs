import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  collectExportTargets,
  collectNodeRuntimeCases,
  collectTypeCustomConditionSets,
  validatePackedExportTargets,
} from './check-sdk-package-exports.mjs'

function withArtifact(files, run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-export-manifest-test-'))
  try {
    for (const file of files) {
      const target = path.join(root, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, '')
    }
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('walks every conditional target without a subpath allow-list', () => {
  const exports = {
    '.': {
      types: {
        browser: './dist/root.browser.d.ts',
        default: './dist/root.d.ts',
      },
      node: {
        import: './dist/root.js',
        require: './dist/root.cjs',
      },
    },
    './new-surface': {
      types: './dist/new.d.ts',
      import: './dist/new.js',
    },
  }

  assert.deepEqual(
    collectExportTargets(exports).map(({ subpath, conditions, target }) => ({
      subpath,
      conditions,
      target,
    })),
    [
      { subpath: '.', conditions: ['types', 'browser'], target: './dist/root.browser.d.ts' },
      { subpath: '.', conditions: ['types', 'default'], target: './dist/root.d.ts' },
      { subpath: '.', conditions: ['node', 'import'], target: './dist/root.js' },
      { subpath: '.', conditions: ['node', 'require'], target: './dist/root.cjs' },
      { subpath: './new-surface', conditions: ['types'], target: './dist/new.d.ts' },
      { subpath: './new-surface', conditions: ['import'], target: './dist/new.js' },
    ]
  )
})

test('fails when any manifest target is missing from the packed artifact', () => {
  const manifest = {
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    },
  }

  withArtifact(['dist/index.js'], root => {
    assert.throws(
      () => validatePackedExportTargets(manifest, root),
      /file target missing from packed artifact.*\.\/dist\/index\.d\.ts/
    )
  })
})

test('rejects directory and package-escaping targets', () => {
  withArtifact([], root => {
    mkdirSync(path.join(root, 'dist/directory.js'), { recursive: true })
    assert.throws(
      () =>
        validatePackedExportTargets(
          {
            exports: {
              '.': './dist/directory.js',
            },
          },
          root
        ),
      /file target missing from packed artifact/
    )
    assert.throws(
      () =>
        validatePackedExportTargets(
          {
            exports: {
              '.': './../outside.js',
            },
          },
          root
        ),
      /target escapes the packed artifact/
    )
  })
})

test('a newly added export automatically joins structural and Node runtime coverage', () => {
  const manifest = {
    name: '@vultisig/sdk',
    exports: {
      '.': {
        import: './dist/index.js',
        require: './dist/index.cjs',
      },
      './added': {
        types: './dist/added.d.ts',
        import: './dist/added.js',
        require: './dist/added.cjs',
      },
      './browser-only': {
        types: './dist/browser-only.d.ts',
        import: './dist/index.browser.js',
      },
    },
  }

  withArtifact(
    [
      'dist/index.js',
      'dist/index.cjs',
      'dist/added.d.ts',
      'dist/added.js',
      'dist/added.cjs',
      'dist/browser-only.d.ts',
      'dist/index.browser.js',
    ],
    root => {
      assert.equal(validatePackedExportTargets(manifest, root).length, 7)
      assert.deepEqual(
        collectNodeRuntimeCases(manifest, 'import').map(({ specifier }) => specifier),
        ['@vultisig/sdk', '@vultisig/sdk/added']
      )
      assert.deepEqual(
        collectNodeRuntimeCases(manifest, 'require').map(({ specifier }) => specifier),
        ['@vultisig/sdk', '@vultisig/sdk/added']
      )
    }
  )
})

test('derives every custom TypeScript declaration condition from the manifest', () => {
  const manifest = {
    exports: {
      '.': {
        types: {
          'chrome-extension': './dist/index.chrome-extension.d.ts',
          browser: './dist/index.browser.d.ts',
          worker: './dist/index.browser.d.ts',
          'react-native': './dist/index.react-native.d.ts',
          default: './dist/index.d.ts',
        },
        import: './dist/index.js',
      },
      './added': {
        types: {
          runtime: {
            embedded: './dist/added.embedded.d.ts',
          },
          default: './dist/added.d.ts',
        },
      },
    },
  }

  assert.deepEqual(collectTypeCustomConditionSets(manifest), [
    ['chrome-extension'],
    ['browser'],
    ['worker'],
    ['react-native'],
    ['runtime', 'embedded'],
  ])
})
