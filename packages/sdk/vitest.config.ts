import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../core'),
      '@lib': resolve(__dirname, '../lib'),
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Default config for unit tests (integration has its own config)
  },
})
