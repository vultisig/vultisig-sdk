import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
      '@fixtures': resolve(__dirname, '../fixtures'),
      '@mocks': resolve(__dirname, './mocks'),
      '@helpers': resolve(__dirname, './helpers'),
      '@utils': resolve(__dirname, '../utils'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.{idea,git,cache,output,temp}/**'],
    setupFiles: [resolve(__dirname, './setup.ts')],
    testTimeout: 60000, // 60 seconds for integration tests (may need network/WASM)
    hookTimeout: 60000,
    teardownTimeout: 10000,
    server: {
      deps: {
        external: ['@trustwallet/wallet-core'],
      },
    },
    // Reporter configuration
    reporters: ['verbose'],
    // Parallel execution
    pool: 'threads',
    isolate: true,
    // Retry failed tests once (helps with flaky tests)
    retry: 1,
  },
})
