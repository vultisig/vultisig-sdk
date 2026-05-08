/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make package boundaries harder to reason about.',
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: 'packages-do-not-import-clients-or-examples',
      severity: 'error',
      comment: 'Published packages must not depend on application clients or examples.',
      from: {
        path: '^packages/',
      },
      to: {
        path: '^(clients|examples)/',
      },
    },
    {
      name: 'shared-core-lib-stays-low-level',
      severity: 'error',
      comment: 'Shared core/lib packages should not import SDK, app, or client layers.',
      from: {
        path: '^packages/(core|lib)/',
      },
      to: {
        path: '^(packages/(sdk|rujira|client-shared|mpc-native|mpc-wasm|walletcore-native)|clients|examples)/',
      },
    },
    {
      name: 'clients-do-not-import-examples',
      severity: 'error',
      comment: 'Clients are product surfaces; examples are consumers, not dependencies.',
      from: {
        path: '^clients/',
      },
      to: {
        path: '^examples/',
      },
    },
    {
      name: 'examples-do-not-import-clients',
      severity: 'error',
      comment: 'Examples should exercise public package APIs instead of client internals.',
      from: {
        path: '^examples/',
      },
      to: {
        path: '^clients/',
      },
    },
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: [
        '(^|/)(dist|dist-electron|coverage|node_modules|testdata|docs/api|tasks)(/|$)',
        '_pb\\.ts$',
        '^packages/mpc-native/ios/',
        '^packages/lib/.+\\.d\\.ts$',
      ].join('|'),
    },
    includeOnly: '^((packages|clients|examples|scripts)/|package\\.json$)',
    progress: {
      type: 'none',
    },
    tsConfig: {
      fileName: '.config/tsconfig.json',
    },
  },
}
