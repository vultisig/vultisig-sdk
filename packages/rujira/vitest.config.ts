import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@vultisig/assets': path.resolve(__dirname, '../assets/src/index.ts'),
    },
  },
});
