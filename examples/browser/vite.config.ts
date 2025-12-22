import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'fs'
import path from 'path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import wasm from 'vite-plugin-wasm'

// Plugin to resolve vite-plugin-node-polyfills shim imports from the SDK
function resolvePolyfillShims(): Plugin {
  return {
    name: 'resolve-polyfill-shims',
    resolveId(id) {
      if (id === 'vite-plugin-node-polyfills/shims/buffer') {
        return { id: '\0polyfill-buffer', external: false }
      }
      if (id === 'vite-plugin-node-polyfills/shims/process') {
        return { id: '\0polyfill-process', external: false }
      }
      if (id === 'vite-plugin-node-polyfills/shims/global') {
        return { id: '\0polyfill-global', external: false }
      }
      return null
    },
    load(id) {
      if (id === '\0polyfill-buffer') {
        return 'import { Buffer } from "buffer"; export { Buffer }; export default Buffer;'
      }
      if (id === '\0polyfill-process') {
        return 'import process from "process/browser"; export { process }; export default process;'
      }
      if (id === '\0polyfill-global') {
        return 'export default globalThis;'
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    wasm(), // Required for WASM loading
    resolvePolyfillShims(), // Handle SDK's polyfill shim imports
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
        const sdkLibPath = path.resolve(__dirname, '../../packages/sdk/dist/lib')
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

          // Copy 7z-wasm files (used for compression during signing)
          const sevenZipPath = path.resolve(__dirname, '../../node_modules/7z-wasm')
          mkdirSync(path.join(__dirname, 'public/7z-wasm'), { recursive: true })
          copyFileSync(path.join(sevenZipPath, '7zz.wasm'), path.join(__dirname, 'public/7z-wasm/7zz.wasm'))

          console.log('✅ Copied WASM files to public/lib/, public/, and public/7z-wasm/')
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
