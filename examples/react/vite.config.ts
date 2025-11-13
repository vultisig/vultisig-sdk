import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'
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
    // Let Vite handle process.env properly for environment variables
  },
  resolve: {
    alias: {
      '@vultisig/sdk': path.resolve(
        __dirname,
        '../../packages/sdk/src/index.ts'
      ),
      'vultisig-sdk': path.resolve(
        __dirname,
        '../../packages/sdk/src/index.ts'
      ),
      '@core': path.resolve(__dirname, '../../packages/core'),
      '@lib': path.resolve(__dirname, '../../packages/lib'),
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      'node:stream': 'stream-browserify',
      'node:stream/web': 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      path: 'path-browserify',
      vm: 'vm-browserify',
      process: 'process/browser',
      events: 'events',
      // Replace node-fetch with native fetch in browser
      'node-fetch': 'isomorphic-fetch',
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
      '@solana/web3.js',
    ],
    exclude: ['node-fetch', 'fetch-blob'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
})
