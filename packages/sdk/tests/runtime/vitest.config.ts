import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
      '@core': resolve(__dirname, '../../../core'),
      '@lib': resolve(__dirname, '../../../lib'),
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
    setupFiles: [resolve(__dirname, '../unit/vitest.setup.ts')],
    testTimeout: 30000, // 30 seconds for runtime tests (WASM loading can take time)
    hookTimeout: 30000, // 30 seconds for hooks
    teardownTimeout: 10000, // 10 seconds for cleanup
    // Allow importing from workspace packages
    deps: {
      external: ['@trustwallet/wallet-core'],
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
    // Retry failed tests once (helps with flaky tests)
    retry: 1,
  },
})
