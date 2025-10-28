import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, './packages/core'),
      '@lib': resolve(__dirname, './packages/lib'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.{js,ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    // Allow importing from workspace packages
    deps: {
      external: ['@trustwallet/wallet-core'],
    },
  },
})
