import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@vultisig/sdk': resolve(__dirname, 'tests/__mocks__/sdk.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
