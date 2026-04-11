import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

const root = resolve(__dirname, '..')

/**
 * Unit tests for `packages/core` and pure helpers in `packages/lib`.
 * Colocated as `*.test.ts` next to sources; run via `yarn test:core` from repo root.
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
    },
  },
  test: {
    environment: 'node',
    include: ['packages/core/**/*.test.ts', 'packages/lib/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    pool: 'forks',
  },
})
