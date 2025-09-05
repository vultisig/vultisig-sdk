import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom', // Changed to jsdom to support WASM loading
    include: ['**/*.{test,spec}.{js,ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Only apply custom setup for our new tests
    pool: 'threads',
    isolate: false,
  },
  resolve: {
    alias: {
      // Ensure WASM files can be found
      '@lib/dkls': resolve(__dirname, 'lib/dkls'),
      '@lib/schnorr': resolve(__dirname, 'lib/schnorr'),
    },
  },
  assetsInclude: ['**/*.wasm'], // Include WASM files as assets
})
