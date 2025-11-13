import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../packages/sdk/src'),
      '@core': resolve(__dirname, '../packages/core'),
      '@lib': resolve(__dirname, '../packages/lib'),
      '@tests': resolve(__dirname, '../packages/sdk/tests'),
      '@fixtures': resolve(__dirname, '../packages/sdk/tests/fixtures'),
      '@mocks': resolve(__dirname, '../packages/sdk/tests/mocks'),
      '@utils': resolve(__dirname, '../packages/sdk/tests/utils'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/sdk/tests/**/*.{test,spec}.{js,ts,tsx}',
      'packages/sdk/src/**/*.{test,spec}.{js,ts,tsx}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/e2e/**', // E2E tests run separately
    ],
    setupFiles: ['./.config/vitest.setup.ts'],
    testTimeout: 30000, // 30 seconds for unit tests (WASM loading can take time)
    hookTimeout: 30000, // 30 seconds for hooks
    teardownTimeout: 10000, // 10 seconds for cleanup
    // Allow importing from workspace packages
    deps: {
      external: ['@trustwallet/wallet-core'],
    },
    // Coverage configuration for Phase 1: 30% target
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
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
      all: true,
      clean: true,
    },
    // Reporter configuration
    reporters: ['verbose'],
    // Parallel execution
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },
    // Retry failed tests once (helps with flaky WASM/network tests)
    retry: 1,
  },
})
