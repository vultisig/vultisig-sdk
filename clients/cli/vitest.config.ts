import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export default defineConfig({
  resolve: {
    alias: {
      // Core-chain LP uses queryUrl; published lib-utils dist uses directory imports that break under Vitest/Vite.
      // Point at source so agent tests exercise real THORChain helpers without broken relative .js emits.
      '@vultisig/lib-utils/query/queryUrl': path.join(workspaceRoot, 'packages/lib/utils/query/queryUrl.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
