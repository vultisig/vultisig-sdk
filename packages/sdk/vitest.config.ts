import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../core'),
      '@lib': resolve(__dirname, '../lib'),
      '@': resolve(__dirname, './src'),
      '@helpers': resolve(__dirname, './tests/helpers'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./tests/setup.ts', './tests/integration/setup.ts'],
    // Setup files load in order: first general setup, then integration-specific WASM polyfill
  },
})
