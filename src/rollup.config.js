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

// Node.js specific externals
const nodeExternal = [
  ...external,
  // Node.js built-ins that should remain external
  'fs',
  'path',
  'os',
  'crypto',
  'buffer',
  'util',
  'stream',
  'events'
]

const browserPlugins = [
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

const nodePlugins = [
  resolve({
    preferBuiltins: true,
    browser: false,
    exportConditions: ['node', 'module', 'import', 'default'],
    // Include workspace packages for bundling
    skip: ['react', 'react-dom', 'axios', 'viem', 'zod', 'uuid', '@trustwallet/wallet-core'],
    // Resolve workspace packages from their source
    alias: {
      '@core/chain': '../core/chain',
      '@core/config': '../core/config',
      '@core/extension': '../core/extension',
      '@core/inpage-provider': '../core/inpage-provider',
      '@core/mpc': '../core/mpc',
      '@core/ui': '../core/ui',
      '@lib/codegen': '../lib/codegen',
      '@lib/dkls': '../lib/dkls',
      '@lib/extension': '../lib/extension',
      '@lib/schnorr': '../lib/schnorr',
      '@lib/ui': '../lib/ui',
      '@lib/utils': '../lib/utils'
    }
  }),
  commonjs({
    include: [/node_modules/, /\.\.\/core\//, /\.\.\/lib\//]
  }),
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
    exclude: ['**/*.test.*', '**/*.stories.*'],
    // Include workspace packages in compilation
    include: ['**/*', '../core/**/*', '../lib/**/*']
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
    // Copy wallet-core WASM from node_modules for Node.js usage
    { 
      src: '../node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm', 
      dest: './dist/wasm/',
      rename: 'wallet-core.wasm'
    }
  ]
})

export default defineConfig([
  // ESM build for browsers
  {
    input: 'index.ts',
    output: {
      file: './dist/index.esm.js',
      format: 'es',
      sourcemap: false // Disable sourcemaps to save memory
    },
    external,
    plugins: [...browserPlugins, wasmCopyPlugin],
    onwarn(warning, warn) {
      // Suppress various warnings to reduce memory usage
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'MISSING_GLOBAL_NAME') return
      if (warning.code === 'UNRESOLVED_IMPORT') return
      warn(warning)
    }
  },
  
  // CommonJS build for Node.js
  {
    input: 'index.ts',
    output: {
      file: './dist/index.js',
      format: 'cjs',
      sourcemap: false,
      exports: 'named',
      interop: 'auto'
    },
    external: nodeExternal,
    plugins: nodePlugins,
    onwarn(warning, warn) {
      // Suppress various warnings
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'MISSING_GLOBAL_NAME') return
      if (warning.code === 'UNRESOLVED_IMPORT') return
      warn(warning)
    }
  },

  // Node.js optimized build
  {
    input: 'index.ts',
    output: {
      file: './dist/index.node.js',
      format: 'cjs',
      sourcemap: false,
      exports: 'named',
      interop: 'auto'
    },
    external: nodeExternal,
    plugins: nodePlugins,
    onwarn(warning, warn) {
      // Suppress various warnings
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'MISSING_GLOBAL_NAME') return
      if (warning.code === 'UNRESOLVED_IMPORT') return
      warn(warning)
    }
  }
])