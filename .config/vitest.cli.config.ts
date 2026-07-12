import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

const root = resolve(__dirname, '..')

/**
 * Vitest for `clients/cli` (agent client, executor, etc.).
 * Run from repo root: `yarn test:cli`
 */
export default defineConfig({
  root,
  resolve: {
    alias: {
      '@vultisig/core-chain': resolve(root, 'packages/core/chain'),
      '@vultisig/core-mpc': resolve(root, 'packages/core/mpc'),
      '@vultisig/core-config': resolve(root, 'packages/core/config'),
      '@vultisig/lib-utils': resolve(root, 'packages/lib/utils'),
      '@vultisig/lib-dkls': resolve(root, 'packages/lib/dkls'),
      '@vultisig/lib-mldsa': resolve(root, 'packages/lib/mldsa'),
      '@vultisig/lib-schnorr': resolve(root, 'packages/lib/schnorr'),
      '@vultisig/mpc-types': resolve(root, 'packages/mpc-types/src'),
      // Point at the leaf FileStorage module, NOT the node platform entry
      // (platforms/node/index.ts), which runs import-time side effects
      // (installs globalThis.crypto/fetch, configures MPC + WASM). config.ts is
      // imported by nearly every CLI test, so aliasing to the entry would leak
      // those side effects into every worker. storage.ts is the only thing the
      // '@vultisig/sdk/node' subpath is used for here (FileStorage).
      '@vultisig/sdk/node': resolve(root, 'packages/sdk/src/platforms/node/storage.ts'),
      '@vultisig/sdk': resolve(root, 'packages/sdk/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['clients/cli/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    pool: 'forks',
    setupFiles: ['clients/cli/tests/setup/cliTestEnv.ts'],
  },
})
