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
      '@utils': resolve(__dirname, '../utils'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [resolve(__dirname, './setup.ts')],
    include: ['./**/*.{test,spec}.{js,ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.{idea,git,cache,output,temp}/**',
      '../e2e/**', // E2E tests run separately
      '../integration/**', // Integration tests run separately
      '../runtime/**', // Runtime tests run separately
    ],
    testTimeout: 30000, // 30 seconds for unit tests (WASM loading can take time)
    hookTimeout: 30000, // 30 seconds for hooks
    teardownTimeout: 10000, // 10 seconds for cleanup
    // Allow importing from workspace packages - inline ESM-only deps
    deps: {
      interopDefault: true,
    },
    server: {
      deps: {
        inline: [/@cosmjs/, /@scure/],
      },
    },
    // Coverage configuration for Phase 1: 30% target
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/**',
        '**/*.config.{js,ts}',
        '**/*.d.ts',
        '**/types/**',
        '**/examples/**',
        '**/scripts/**',
      ],
      // Phase 1 coverage thresholds (30%)
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
      },
      clean: true,
    },
    // Reporter configuration
    reporters: ['verbose'],
    // Parallel execution - use forks for better ESM compatibility
    pool: 'forks',
    isolate: true,
    // Retry failed tests once (helps with flaky WASM/network tests)
    retry: 1,
  },
})
