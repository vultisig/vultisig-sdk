import { defineConfig } from 'rollup'
import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import terser from '@rollup/plugin-terser'
import copy from 'rollup-plugin-copy'
import dts from 'rollup-plugin-dts'

const external = [
  // Peer dependencies
  'react',
  'react-dom',
  
  // Node modules that should be external in library builds
  'axios',
  'viem', 
  'zod',
  'uuid',
  
  // Keep WASM modules external for proper loading
  '@trustwallet/wallet-core',
  
  // Node.js built-ins (will be polyfilled by bundlers if needed)
  'crypto',
  'buffer',
  'util',
  'stream'
  
  // Note: Workspace packages (@core/*, @lib/*) are now bundled by removing them from external
]

const plugins = [
  resolve({
    preferBuiltins: false,
    browser: true,
    exportConditions: ['browser', 'module', 'import', 'default'],
    // Include workspace packages for bundling
    skip: ['react', 'react-dom', 'axios', 'viem', 'zod', 'uuid', '@trustwallet/wallet-core']
  }),
  commonjs({
    include: /node_modules/
  }),
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
    exclude: ['**/*.test.*', '**/*.stories.*']
  })
]

const wasmCopyPlugin = copy({
  targets: [
    // Copy WASM files to dist for proper loading
    { 
      src: '../lib/dkls/vs_wasm_bg.wasm', 
      dest: './dist/wasm/',
      rename: 'dkls.wasm'
    },
    { 
      src: '../lib/schnorr/vs_schnorr_wasm_bg.wasm', 
      dest: './dist/wasm/',
      rename: 'schnorr.wasm' 
    },
    // wallet-core.wasm will be handled by the consuming application
  ]
})

export default defineConfig([
  // ESM build only for now
  {
    input: 'index.ts',
    output: {
      file: './dist/index.esm.js',
      format: 'es',
      sourcemap: false // Disable sourcemaps to save memory
    },
    external,
    plugins: [...plugins, wasmCopyPlugin],
    onwarn(warning, warn) {
      // Suppress various warnings to reduce memory usage
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'MISSING_GLOBAL_NAME') return
      if (warning.code === 'UNRESOLVED_IMPORT') return
      warn(warning)
    }
  }
])