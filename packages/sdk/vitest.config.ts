import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@vultisig/core-chain': resolve(__dirname, '../core/chain'),
      '@vultisig/core-mpc': resolve(__dirname, '../core/mpc'),
      '@vultisig/core-config': resolve(__dirname, '../core/config'),
      '@vultisig/lib-utils': resolve(__dirname, '../lib/utils'),
      '@vultisig/lib-dkls': resolve(__dirname, '../lib/dkls'),
      '@vultisig/lib-mldsa': resolve(__dirname, '../lib/mldsa'),
      '@vultisig/lib-schnorr': resolve(__dirname, '../lib/schnorr'),
      '@': resolve(__dirname, './src'),
      '@helpers': resolve(__dirname, './tests/helpers'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Exclude E2E tests from default run - they require special setup and env vars
      // Use yarn test:e2e or yarn test:e2e:* scripts to run E2E tests
      'tests/e2e/**',
    ],
    setupFiles: ['./tests/setup.ts', './tests/integration/setup.ts'],
    // Setup files load in order: first general setup, then integration-specific WASM polyfill
  },
})
