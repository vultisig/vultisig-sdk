import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Load environment variables from tests/e2e/.env
  envDir: resolve(__dirname),

  test: {
    name: 'e2e',
    root: resolve(__dirname, '../..'),
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/e2e/funded/**'],

    // E2E tests need longer timeouts for real network + MPC relay rounds
    testTimeout: 120_000,
    hookTimeout: 120_000,
    teardownTimeout: 10000,

    // MPC sessions must not share the public relay concurrently (message races / rate limits).
    fileParallelism: false,

    // Enable console logs for debugging
    silent: false,

    // Globals for test utilities
    globals: true,

    // One file per fork so WASM / signing state does not accumulate across 14 suites (avoids multi-GB heap OOM).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 1,
      },
    },

    // Setup files
    setupFiles: [
      resolve(__dirname, './setup.ts'), // E2E-specific setup
      resolve(__dirname, '../setup.ts'), // Test utilities
    ],
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
      '@vultisig/core-chain': resolve(__dirname, '../../../core/chain'),
      '@vultisig/core-mpc': resolve(__dirname, '../../../core/mpc'),
      '@vultisig/core-config': resolve(__dirname, '../../../core/config'),
      '@vultisig/lib-utils': resolve(__dirname, '../../../lib/utils'),
      '@vultisig/lib-dkls': resolve(__dirname, '../../../lib/dkls'),
      '@vultisig/lib-mldsa': resolve(__dirname, '../../../lib/mldsa'),
      '@vultisig/lib-schnorr': resolve(__dirname, '../../../lib/schnorr'),
      '@vultisig/mpc-types': resolve(__dirname, '../../../mpc-types/src'),
      '@vultisig/mpc-wasm': resolve(__dirname, '../../../mpc-wasm/src'),
      '@tests': resolve(__dirname, '..'),
      '@helpers': resolve(__dirname, './helpers'),
      '@fixtures': resolve(__dirname, '../fixtures'),
    },
  },
})
