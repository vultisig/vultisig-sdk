import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@vultisig/assets': path.resolve(__dirname, '../assets/src/index.ts'),
    },
  },
})
