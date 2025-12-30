import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

const dirName = path.dirname(fileURLToPath(import.meta.url))

// Plugin to copy WASM files needed by the main process
function copyWasmFiles(): { name: string; buildStart: () => void } {
  return {
    name: 'copy-wasm-files',
    buildStart() {
      const distElectron = path.resolve(dirName, 'dist-electron')
      const sdkDist = path.resolve(dirName, '../../packages/sdk/dist')

      // Ensure output directories exist
      mkdirSync(distElectron, { recursive: true })
      mkdirSync(path.join(distElectron, 'lib/dkls'), { recursive: true })
      mkdirSync(path.join(distElectron, 'lib/schnorr'), { recursive: true })

      // 1. secp256k1.wasm - tiny-secp256k1 uses path.join(dirName, "..", wasmFilename)
      //    When bundled, dirName is dist-electron/, so it looks in examples/electron/
      //    Note: tiny-secp256k1 is installed in packages/sdk/node_modules, not root node_modules
      copyFileSync(
        path.join(sdkDist, '../node_modules/tiny-secp256k1/lib/secp256k1.wasm'),
        path.resolve(dirName, 'secp256k1.wasm')
      )

      // 2. wallet-core.wasm - Trust Wallet Core (loaded via fetch polyfill)
      //    Note: @trustwallet/wallet-core is installed in packages/sdk/node_modules, not root node_modules
      copyFileSync(
        path.join(sdkDist, '../node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'),
        path.join(distElectron, 'wallet-core.wasm')
      )

      // 3. MPC WASM files - DKLS and Schnorr (loaded via fetch polyfill)
      copyFileSync(path.join(sdkDist, 'lib/dkls/vs_wasm_bg.wasm'), path.join(distElectron, 'lib/dkls/vs_wasm_bg.wasm'))
      copyFileSync(
        path.join(sdkDist, 'lib/schnorr/vs_schnorr_wasm_bg.wasm'),
        path.join(distElectron, 'lib/schnorr/vs_schnorr_wasm_bg.wasm')
      )

      console.log('Copied all WASM files to dist-electron/')
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'electron/main.ts',
        vite: {
          plugins: [copyWasmFiles()],
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', '@vultisig/sdk', '@vultisig/sdk/electron/main'],
            },
          },
        },
      },
      {
        // Preload script
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
        onstart(options) {
          options.reload()
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(dirName, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
})
