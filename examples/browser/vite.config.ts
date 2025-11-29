import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'fs'
import path from 'path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'

export default defineConfig({
  plugins: [
    react(),
    wasm(), // Required for WASM loading
    nodePolyfills({
      exclude: ['fs'], // fs not available in browser
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }),
    // Copy WASM files from SDK to public directory
    {
      name: 'copy-wasm-files',
      buildStart() {
        const sdkLibPath = path.resolve(__dirname, '../../packages/sdk/lib')
        const publicLibPath = path.resolve(__dirname, 'public/lib')

        try {
          // Create lib directories
          mkdirSync(path.join(publicLibPath, 'dkls'), { recursive: true })
          mkdirSync(path.join(publicLibPath, 'schnorr'), { recursive: true })

          // Copy DKLS WASM files
          copyFileSync(path.join(sdkLibPath, 'dkls/vs_wasm_bg.wasm'), path.join(publicLibPath, 'dkls/vs_wasm_bg.wasm'))
          copyFileSync(path.join(sdkLibPath, 'dkls/vs_wasm.js'), path.join(publicLibPath, 'dkls/vs_wasm.js'))

          // Copy Schnorr WASM files
          copyFileSync(
            path.join(sdkLibPath, 'schnorr/vs_schnorr_wasm_bg.wasm'),
            path.join(publicLibPath, 'schnorr/vs_schnorr_wasm_bg.wasm')
          )
          copyFileSync(
            path.join(sdkLibPath, 'schnorr/vs_schnorr_wasm.js'),
            path.join(publicLibPath, 'schnorr/vs_schnorr_wasm.js')
          )

          // Copy WalletCore WASM files (from @trustwallet/wallet-core package)
          const walletCoreLibPath = path.resolve(__dirname, '../../node_modules/@trustwallet/wallet-core/dist/lib')
          copyFileSync(
            path.join(walletCoreLibPath, 'wallet-core.wasm'),
            path.join(__dirname, 'public/wallet-core.wasm')
          )
          copyFileSync(path.join(walletCoreLibPath, 'wallet-core.js'), path.join(__dirname, 'public/wallet-core.js'))

          console.log('✅ Copied WASM files to public/lib/ and public/')
        } catch (error) {
          console.error('Failed to copy WASM files:', error)
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Polyfills for Node.js modules
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      buffer: 'buffer',
      util: 'util',
      path: 'path-browserify',
      events: 'events',
      'node-fetch': 'isomorphic-fetch',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'process', 'crypto-browserify', 'stream-browserify', 'events'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          sdk: ['@vultisig/sdk'],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
})
