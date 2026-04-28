import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const e2eDir = resolve(__dirname, '..')
const e2eDotenv = resolve(e2eDir, '.env')
if (existsSync(e2eDotenv)) {
  loadDotenv({ path: e2eDotenv })
}

export default defineConfig({
  envDir: e2eDir,

  test: {
    name: 'e2e-funded',
    root: resolve(__dirname, '../../..'),
    include: ['tests/e2e/funded/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],

    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 15_000,

    fileParallelism: false,
    silent: false,
    globals: true,

    pool: 'forks',
    maxWorkers: 1,

    setupFiles: [resolve(e2eDir, 'setup.ts'), resolve(__dirname, '../../setup.ts')],
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, '../../../src'),
      '@vultisig/core-chain': resolve(__dirname, '../../../../core/chain'),
      '@vultisig/core-mpc': resolve(__dirname, '../../../../core/mpc'),
      '@vultisig/core-config': resolve(__dirname, '../../../../core/config'),
      '@vultisig/lib-utils': resolve(__dirname, '../../../../lib/utils'),
      '@vultisig/lib-dkls': resolve(__dirname, '../../../../lib/dkls'),
      '@vultisig/lib-mldsa': resolve(__dirname, '../../../../lib/mldsa'),
      '@vultisig/lib-schnorr': resolve(__dirname, '../../../../lib/schnorr'),
      '@tests': resolve(__dirname, '../..'),
      '@helpers': resolve(e2eDir, 'helpers'),
      '@fixtures': resolve(__dirname, '../../fixtures'),
    },
  },
})
