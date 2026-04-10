import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@vultisig/mpc-types': resolve(__dirname, '../mpc-types/src'),
      '@vultisig/mpc-wasm': resolve(__dirname, '../mpc-wasm/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
