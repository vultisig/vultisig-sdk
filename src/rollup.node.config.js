import { defineConfig } from 'rollup'
import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import copy from 'rollup-plugin-copy'
import json from '@rollup/plugin-json'

// External dependencies that should not be bundled
const external = [
  // Node.js built-ins
  'fs',
  'path',
  'crypto',
  'buffer',
  'util',
  'stream',
  'events',
  'os',

  // Runtime globals that should not be bundled
  'fetch',

  // External npm packages
  'axios',
  'viem',
  'zod',
  '@trustwallet/wallet-core',
  '@solana/web3.js',

  // React (not needed for CLI)
  'react',
  'react-dom',
  'react-i18next',
  'i18next',
]

const plugins = [
  // Handle JSON imports
  json(),

  // Resolve modules
  resolve({
    preferBuiltins: true,
    browser: false,
    exportConditions: ['node', 'default'],
    // Don't skip workspace packages - we want to bundle them
    skip: external,
  }),

  // Handle CommonJS modules
  commonjs({
    include: [/node_modules/, /\.\.\/core\//, /\.\.\/lib\//],
    requireReturnsDefault: 'auto',
  }),

  // TypeScript compilation
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
    exclude: ['**/*.test.*', '**/*.stories.*'],
    // Include workspace packages
    include: [
      '**/*.ts',
      '**/*.tsx',
      '../core/**/*.ts',
      '../core/**/*.tsx',
      '../lib/**/*.ts',
      '../lib/**/*.tsx',
    ],
    compilerOptions: {
      target: 'ES2020',
      module: 'ESNext',
      moduleResolution: 'node',
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
      skipLibCheck: true,
      declaration: false,
      sourceMap: false,
      // Resolve workspace packages
      baseUrl: '.',
      paths: {
        '@core/*': ['../core/*'],
        '@lib/*': ['../lib/*'],
      },
    },
  }),
]

const wasmCopyPlugin = copy({
  targets: [
    {
      src: '../lib/dkls/vs_wasm_bg.wasm',
      dest: './dist/wasm/',
      rename: 'dkls.wasm',
    },
    {
      src: '../lib/schnorr/vs_schnorr_wasm_bg.wasm',
      dest: './dist/wasm/',
      rename: 'schnorr.wasm',
    },
    // Try to copy wallet-core WASM
    {
      src: '../node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm',
      dest: './dist/wasm/',
      rename: 'wallet-core.wasm',
    },
    // Copy secp256k1 WASM from tiny-secp256k1
    {
      src: '../node_modules/tiny-secp256k1/lib/secp256k1.wasm',
      dest: './dist/wasm/',
      rename: 'secp256k1.wasm',
    },
    // Also copy to dist root for compatibility
    {
      src: '../node_modules/tiny-secp256k1/lib/secp256k1.wasm',
      dest: './dist/',
      rename: 'secp256k1.wasm',
    },
  ],
})

export default defineConfig([
  // Node.js CommonJS build with workspace packages bundled
  {
    input: 'index.ts',
    output: {
      file: './dist/index.node.cjs',
      format: 'cjs',
      sourcemap: false,
      exports: 'named',
      interop: 'auto',
      inlineDynamicImports: true,
    },
    external,
    plugins: [...plugins, wasmCopyPlugin],
    onwarn(warning, warn) {
      // Suppress various warnings
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'MISSING_GLOBAL_NAME') return
      if (warning.code === 'UNRESOLVED_IMPORT') return
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      warn(warning)
    },
  },
])
