import alias from '@rollup/plugin-alias'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import path from 'path'
import { defineConfig } from 'rollup'
import copy from 'rollup-plugin-copy'
import esbuild from 'rollup-plugin-esbuild'
import { fileURLToPath } from 'url'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const external = [
  'axios',
  'viem',
  'zod',
  'uuid',
  '@trustwallet/wallet-core',
  'crypto',
  'buffer',
  'util',
  'stream',
  'url',
  'fs',
  'fs/promises',
  'path',
  'os',
  'electron',
  '@react-native-async-storage/async-storage',
  /\.wasm$/,
  // wasm-bindgen generated JS must be external - bundling breaks externref tables
  /lib\/dkls\/vs_wasm/,
  /lib\/schnorr\/vs_schnorr_wasm/,
  'tiny-secp256k1',
  '@solana/web3.js',
  '@cosmjs/stargate',
  '@cosmjs/amino',
  '@bufbuild/protobuf',
  'ripple-binary-codec',
  // 7z-wasm uses Emscripten-style WASM loading - must stay external so it can find its .wasm file
  '7z-wasm',
]

// Rewrite WASM import paths for bundled output
// Converts ../../../lib/dkls/vs_wasm to ./lib/dkls/vs_wasm.js (relative to dist/)
const wasmPathsResolver = id => {
  if (id.match(/lib\/dkls\/vs_wasm/)) return './lib/dkls/vs_wasm.js'
  if (id.match(/lib\/schnorr\/vs_schnorr_wasm/)) return './lib/schnorr/vs_schnorr_wasm.js'
  return id
}

const wasmCopyPlugin = copy({
  targets: [
    { src: '../lib/dkls', dest: './dist/lib' },
    { src: '../lib/schnorr', dest: './dist/lib' },
  ],
})

// Centralized warning handler - suppresses expected warnings from WASM loading and dependencies
const onwarn = (warning, warn) => {
  // DYNAMIC_IMPORT: Expected for WASM lazy loading
  // CIRCULAR_DEPENDENCY: Known circular dependencies in SDK internals
  // 'this' warnings: From @wallet-standard CommonJS modules
  if (warning.code === 'DYNAMIC_IMPORT' || warning.code === 'CIRCULAR_DEPENDENCY' || warning.message?.includes('this'))
    return
  warn(warning)
}

const createPlugins = (platformOptions = {}) => {
  const { preferBuiltins = false, browser = false, replaceOptions = {} } = platformOptions

  return [
    alias({
      entries: [
        { find: /^@core\/(.*)/, replacement: path.resolve(currentDir, '../core/$1') },
        { find: /^@lib\/(.*)/, replacement: path.resolve(currentDir, '../lib/$1') },
      ],
    }),
    resolve({
      preferBuiltins,
      browser,
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      exportConditions: browser ? ['browser', 'module', 'import', 'default'] : ['node', 'module', 'import', 'default'],
      skip: [
        'axios',
        'viem',
        'zod',
        'uuid',
        '@trustwallet/wallet-core',
        'tiny-secp256k1',
        '@solana/web3.js',
        '@cosmjs/stargate',
        '@cosmjs/amino',
      ],
      ignore: [/\.wasm$/],
    }),
    replace({ preventAssignment: true, ...replaceOptions }),
    esbuild({
      include: ['./src/**/*', '../core/**/*', '../lib/**/*'],
      exclude: ['**/*.test.*', '**/*.stories.*', '**/node_modules/**'],
      target: 'es2021',
      minify: false,
      tsconfig: './tsconfig.json',
    }),
    json(),
    commonjs({ include: [/node_modules/], transformMixedEsModules: true }),
    terser({
      format: { comments: false },
      compress: { passes: 1, drop_debugger: true },
      mangle: { keep_fnames: true, keep_classnames: true },
    }),
  ]
}

// Get target from environment variable
const target = process.env.BUILD_TARGET || 'all'

const configs = {
  node: [
    {
      input: './src/platforms/node/index.ts',
      output: {
        file: './dist/index.node.esm.js',
        format: 'es',
        sourcemap: true,
        inlineDynamicImports: true,
        paths: wasmPathsResolver,
      },
      external,
      plugins: [
        ...createPlugins({
          preferBuiltins: true,
          replaceOptions: {
            'process.env.VULTISIG_PLATFORM': JSON.stringify('node'),
          },
        }),
        wasmCopyPlugin,
      ],
      onwarn,
    },
    {
      input: './src/platforms/node/index.ts',
      output: {
        file: './dist/index.node.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
        interop: 'auto',
        inlineDynamicImports: true,
        paths: wasmPathsResolver,
      },
      external,
      plugins: createPlugins({
        preferBuiltins: true,
        replaceOptions: {
          'process.env.VULTISIG_PLATFORM': JSON.stringify('node'),
        },
      }),
    },
  ],
  browser: {
    input: './src/platforms/browser/index.ts',
    output: {
      file: './dist/index.browser.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
      paths: wasmPathsResolver,
    },
    external,
    plugins: createPlugins({
      preferBuiltins: false,
      browser: true,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('browser'),
      },
    }),
    onwarn,
  },
  'react-native': {
    input: './src/platforms/react-native/index.ts',
    output: {
      file: './dist/index.react-native.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
      paths: wasmPathsResolver,
    },
    external,
    plugins: createPlugins({
      preferBuiltins: false,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('react-native'),
        'typeof window': JSON.stringify('undefined'),
      },
    }),
    onwarn,
  },
  electron: {
    input: './src/platforms/electron-main/index.ts',
    output: {
      file: './dist/index.electron-main.cjs',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
      interop: 'auto',
      inlineDynamicImports: true,
      paths: wasmPathsResolver,
    },
    external,
    plugins: createPlugins({
      preferBuiltins: true,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('electron'),
      },
    }),
    onwarn,
  },
  'chrome-extension': {
    input: './src/platforms/chrome-extension/index.ts',
    output: {
      file: './dist/index.chrome-extension.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
      paths: wasmPathsResolver,
    },
    external,
    plugins: createPlugins({
      preferBuiltins: false,
      browser: true,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('chrome-extension'),
      },
    }),
    onwarn,
  },
}

// Export based on target
let exportConfig
if (target === 'all') {
  exportConfig = [
    ...configs.node,
    configs.browser,
    configs['react-native'],
    configs.electron,
    configs['chrome-extension'],
  ]
} else if (configs[target]) {
  const config = configs[target]
  exportConfig = Array.isArray(config) ? config : [config]
} else {
  throw new Error(
    `Unknown build target: ${target}. Available targets: node, browser, react-native, electron, chrome-extension, all`
  )
}

export default defineConfig(exportConfig)
