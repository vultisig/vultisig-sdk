import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  collectExportTargets,
  collectIntrospectableRuntimeCases,
  collectLocalWorkspaceDependencyNames,
  collectNodeRuntimeCases,
  collectRuntimeExportKeys,
  collectTypeCustomConditionSets,
  createPackedConsumerManifest,
  hasSdkDependencyAncestry,
  validateNoInstalledReactNativeFormatJs,
  validatePackedExportTargets,
  validatePackedReactNativeIntl,
  validateReactNativeFormatJsDependencies,
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

test('React Native FormatJS packages are build inputs, not consumer dependencies', () => {
  const names = [
    '@formatjs/intl-getcanonicallocales',
    '@formatjs/intl-locale',
    '@formatjs/intl-numberformat',
    '@formatjs/intl-pluralrules',
  ]
  const manifest = { devDependencies: Object.fromEntries(names.map(name => [name, '^1.0.0'])) }
  assert.doesNotThrow(() => validateReactNativeFormatJsDependencies(manifest))
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.throws(
      () => validateReactNativeFormatJsDependencies({ ...manifest, [field]: { [names[0]]: '^1.0.0' } }),
      new RegExp(`must not be an SDK ${field} entry`)
    )
  }
  assert.throws(
    () => validateReactNativeFormatJsDependencies({ devDependencies: {} }),
    /must remain an SDK build dependency/
  )
})

test('clean packed consumers do not contain React Native FormatJS packages', () => {
  withArtifact([], root => {
    assert.doesNotThrow(() => validateNoInstalledReactNativeFormatJs(root))
    const installedPackage = path.join(root, 'node_modules/@formatjs/intl-numberformat')
    mkdirSync(installedPackage, { recursive: true })
    assert.throws(() => validateNoInstalledReactNativeFormatJs(root), /Command failed: npm explain/)
  })
})

test('FormatJS provenance rejects SDK runtime ancestry but permits independent consumers', () => {
  const sdk = { name: '@vultisig/sdk' }
  const sdkChild = { name: '@vultisig/core-chain', dependents: [{ from: sdk }] }
  const unrelated = { name: 'unrelated-consumer', dependents: [{ from: { name: 'test-consumer' } }] }
  assert.equal(hasSdkDependencyAncestry(sdk), true)
  assert.equal(hasSdkDependencyAncestry(sdkChild), true)
  assert.equal(hasSdkDependencyAncestry(unrelated), false)
  assert.equal(
    hasSdkDependencyAncestry({ name: 'shared', dependents: [{ from: unrelated }, { from: sdkChild }] }),
    true
  )
})

test('packed React Native entrypoints retain bundled Intl data without FormatJS imports', () => {
  withArtifact(
    ['dist/index.react-native.js', 'dist/tools/prep/index.react-native.js', 'dist/chunks/react-native/intl.js'],
    root => {
      const chunk = path.join(root, 'dist/chunks/react-native/intl.js')
      const marker = 'getCanonicalLocales Locale NumberFormat PluralRules __addLocaleData'
      const registrations = `
Intl.NumberFormat.__addLocaleData({ locale: 'en' })
Intl.PluralRules.__addLocaleData({ locale: 'en' })
`
      writeFileSync(chunk, `export const marker = ${JSON.stringify(marker)}; ${registrations}`)
      writeFileSync(path.join(root, 'dist/index.react-native.js'), "import './chunks/react-native/intl.js'")
      writeFileSync(
        path.join(root, 'dist/tools/prep/index.react-native.js'),
        "import '../../chunks/react-native/intl.js'"
      )
      assert.doesNotThrow(() => validatePackedReactNativeIntl(root))
      writeFileSync(
        chunk,
        `export const marker = ${JSON.stringify(marker)};
Intl.NumberFormat.__addLocaleData({ 'locale': 'en' })
Intl.PluralRules.__addLocaleData({ 'locale': 'en' })`
      )
      assert.doesNotThrow(() => validatePackedReactNativeIntl(root))
      writeFileSync(path.join(root, 'dist/index.react-native.js'), 'export const sdk = true')
      assert.throws(
        () => validatePackedReactNativeIntl(root),
        /index.react-native.js must embed Intl getCanonicalLocales/
      )
      writeFileSync(path.join(root, 'dist/index.react-native.js'), "import './chunks/react-native/intl.js'")
      writeFileSync(chunk, "import '@formatjs/intl-numberformat/polyfill.js'")
      assert.throws(() => validatePackedReactNativeIntl(root), /must bundle FormatJS instead of referencing it/)
      writeFileSync(
        chunk,
        `export const marker = ${JSON.stringify(marker)}; Intl.NumberFormat.__addLocaleData({ locale: 'en' })`
      )
      assert.throws(() => validatePackedReactNativeIntl(root), /must register English PluralRules locale data/)
      writeFileSync(chunk, 'export const marker = "PluralRules"')
      assert.throws(() => validatePackedReactNativeIntl(root), /must embed Intl getCanonicalLocales/)
    }
  )
})

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

test('packed consumers resolve the complete local SDK dependency graph without npm publication', () => {
  const workspaceManifests = new Map([
    [
      '@vultisig/sdk',
      {
        version: '6.3.0',
        dependencies: {
          '@vultisig/core-chain': '4.1.1',
          '@vultisig/core-mpc': '2.1.1',
          '@vultisig/lib-dkls': '0.9.0',
        },
        peerDependencies: {
          '@vultisig/mpc-native': '*',
        },
      },
    ],
    [
      '@vultisig/core-chain',
      {
        version: '4.1.1',
        dependencies: {
          '@vultisig/lib-utils': '0.10.7',
          '@vultisig/mpc-types': '0.3.0',
        },
      },
    ],
    [
      '@vultisig/core-mpc',
      {
        version: '2.1.1',
        dependencies: {
          '@vultisig/core-chain': '4.1.1',
          '@vultisig/mpc-types': '0.3.0',
        },
      },
    ],
    ['@vultisig/lib-utils', { version: '0.10.7', dependencies: {} }],
    ['@vultisig/mpc-types', { version: '0.3.0', dependencies: {} }],
    ['@vultisig/lib-dkls', { version: '0.9.0', dependencies: {} }],
  ])

  assert.deepEqual(collectLocalWorkspaceDependencyNames('@vultisig/sdk', workspaceManifests), [
    '@vultisig/core-chain',
    '@vultisig/core-mpc',
    '@vultisig/lib-utils',
    '@vultisig/mpc-types',
  ])

  assert.deepEqual(
    createPackedConsumerManifest({
      '@vultisig/core-chain': 'file:/tmp/vultisig-core-chain-4.1.1.tgz',
      '@vultisig/core-mpc': 'file:/tmp/vultisig-core-mpc-2.1.1.tgz',
      '@vultisig/lib-utils': 'file:/tmp/vultisig-lib-utils-0.10.7.tgz',
      '@vultisig/mpc-types': 'file:/tmp/vultisig-mpc-types-0.3.0.tgz',
    }),
    {
      name: 'vultisig-sdk-package-export-consumer',
      private: true,
      type: 'module',
      packageManager: 'yarn@4.16.0',
      resolutions: {
        '@vultisig/core-chain': 'file:/tmp/vultisig-core-chain-4.1.1.tgz',
        '@vultisig/core-mpc': 'file:/tmp/vultisig-core-mpc-2.1.1.tgz',
        '@vultisig/lib-utils': 'file:/tmp/vultisig-lib-utils-0.10.7.tgz',
        '@vultisig/mpc-types': 'file:/tmp/vultisig-mpc-types-0.3.0.tgz',
      },
    }
  )
})

test('packed consumers reject an incompatible coordinated dependency selector', () => {
  const packedManifests = new Map([
    ['@vultisig/sdk', { version: '6.3.0', dependencies: { '@vultisig/core-mpc': '2.1.1' } }],
    ['@vultisig/core-mpc', { version: '2.1.1', dependencies: { '@vultisig/core-chain': '4.1.0' } }],
    ['@vultisig/core-chain', { version: '4.1.1', dependencies: {} }],
    ['@vultisig/mpc-types', { version: '0.3.0', dependencies: {} }],
  ])

  assert.throws(
    () => collectLocalWorkspaceDependencyNames('@vultisig/sdk', packedManifests),
    /core-mpc requires @vultisig\/core-chain@4\.1\.0.*local archive.*4\.1\.1/
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

test('introspectable runtime cases include browser/chrome-extension and seedphrase but exclude react-native/rn-preamble/root', () => {
  const manifest = {
    name: '@vultisig/sdk',
    exports: {
      '.': {
        node: { import: './dist/index.node.esm.js', require: './dist/index.node.cjs' },
        import: './dist/index.node.esm.js',
        require: './dist/index.node.cjs',
      },
      './browser': {
        types: './dist/index.browser.d.ts',
        import: './dist/index.browser.js',
      },
      './react-native': {
        types: './dist/index.react-native.d.ts',
        'react-native': './dist/index.react-native.js',
        import: './dist/index.react-native.js',
        default: './dist/index.react-native.js',
      },
      './rn-preamble': {
        types: './dist/index.rn-preamble.d.ts',
        'react-native': './dist/index.rn-preamble.js',
        import: './dist/index.rn-preamble.js',
        default: './dist/index.rn-preamble.js',
      },
      './seedphrase': {
        types: './dist/seedphrase/index.d.ts',
        node: { import: './dist/seedphrase/index.js', require: './dist/seedphrase/index.cjs' },
        import: './dist/seedphrase/index.js',
        require: './dist/seedphrase/index.cjs',
      },
    },
  }

  assert.deepEqual(
    collectIntrospectableRuntimeCases(manifest).map(({ specifier }) => specifier),
    ['@vultisig/sdk/browser', '@vultisig/sdk/seedphrase']
  )
})

test('runtime export keys are collected from the packed module and empty modules are skipped', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-runtime-export-keys-test-'))
  try {
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    writeFileSync(
      path.join(root, 'dist/with-exports.mjs'),
      'export const normalizeMnemonic = (value) => value.trim()\nexport class SeedphraseValidator {}\n'
    )
    writeFileSync(path.join(root, 'dist/empty.mjs'), 'export {}\n')

    const keys = collectRuntimeExportKeys(root, [
      { specifier: '@vultisig/sdk/seedphrase', target: './dist/with-exports.mjs' },
      { specifier: '@vultisig/sdk/empty', target: './dist/empty.mjs' },
    ])

    assert.deepEqual(keys, {
      '@vultisig/sdk/seedphrase': ['SeedphraseValidator', 'normalizeMnemonic'],
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime export introspection isolates modules and reports timeout context', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-runtime-export-timeout-test-'))
  try {
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    writeFileSync(
      path.join(root, 'dist/hangs.mjs'),
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000)\nexport const value = true\n'
    )

    assert.throws(
      () =>
        collectRuntimeExportKeys(root, [{ specifier: '@vultisig/sdk/hangs', target: './dist/hangs.mjs' }], {
          timeoutMs: 100,
        }),
      /timed out after 100ms.*@vultisig\/sdk\/hangs target \.\/dist\/hangs\.mjs/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime export introspection reports import failures with specifier and target', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sdk-runtime-export-failure-test-'))
  try {
    assert.throws(
      () => collectRuntimeExportKeys(root, [{ specifier: '@vultisig/sdk/missing', target: './dist/missing.mjs' }]),
      /failed for @vultisig\/sdk\/missing target \.\/dist\/missing\.mjs/
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
