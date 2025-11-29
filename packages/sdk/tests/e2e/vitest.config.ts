import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Load environment variables from tests/e2e/.env
  envDir: resolve(__dirname),

  test: {
    name: 'e2e',
    root: resolve(__dirname, '../..'),
    include: ['tests/e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    // E2E tests need longer timeouts for real network calls
    testTimeout: 60000, // 60 seconds per test
    hookTimeout: 60000,
    teardownTimeout: 10000,

    // Enable console logs for debugging
    silent: false,

    // Globals for test utilities
    globals: true,

    // Run tests in parallel using threads pool
    // Each test file gets its own thread with isolated module state
    // Note: Each thread will load its own WASM instance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false, // Enable parallel threads
        maxThreads: 6, // Limit parallelism to avoid rate limiting
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
      '@core': resolve(__dirname, '../../../core'),
      '@lib': resolve(__dirname, '../../../lib'),
      '@tests': resolve(__dirname, '..'),
      '@helpers': resolve(__dirname, './helpers'),
      '@fixtures': resolve(__dirname, '../fixtures'),
    },
  },
})
