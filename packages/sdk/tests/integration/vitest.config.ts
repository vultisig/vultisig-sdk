import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'integration',
    include: ['**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./setup.ts'],
    testTimeout: 60000, // 60 seconds for network operations
    hookTimeout: 30000,
    globals: false,
    // Run tests sequentially to avoid race conditions with shared vault
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, '../../../core'),
      '@lib': path.resolve(__dirname, '../../../lib'),
      '@': path.resolve(__dirname, '../../src'),
    },
  },
});
