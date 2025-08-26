import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
  plugins: [react(), wasm(), nodePolyfills({ exclude: ['fs'] })],
  server: {
    port: 3000,
  },
  build: {
    target: 'esnext',
  },
  assetsInclude: ['**/*.wasm'],
  define: {
    global: 'globalThis',
    'process.env': '{}',
  },
  resolve: {
    alias: {
      '@vultisig/sdk': path.resolve(__dirname, '../../src/index.ts'),
      'vultisig-sdk': path.resolve(__dirname, '../../src/index.ts'),
      '@lib/utils': path.resolve(__dirname, '../../lib/utils'),
      '@core': path.resolve(__dirname, '../../core'),
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      path: 'path-browserify',
      vm: 'vm-browserify',
      process: 'process/browser',
      events: 'events',
    },
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    include: [
      'buffer',
      'process',
      'util',
      'crypto-browserify',
      'stream-browserify',
      'events',
      'readable-stream',
      'string_decoder',
    ],
  },
})
