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
      '@vultisig/sdk': resolve(root, 'packages/sdk/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['clients/cli/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    pool: 'forks',
  },
})
