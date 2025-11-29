import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'
import copy from 'rollup-plugin-copy'

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
  'tiny-secp256k1',
  '@solana/web3.js',
  '@cosmjs/stargate',
  '@cosmjs/amino',
  '@bufbuild/protobuf',
  'ripple-binary-codec',
]

const wasmCopyPlugin = copy({
  targets: [
    { src: '../lib/dkls', dest: './dist/lib' },
    { src: '../lib/schnorr', dest: './dist/lib' },
  ],
})

const createPlugins = (platformOptions = {}) => {
  const { preferBuiltins = false, browser = false, replaceOptions = {} } = platformOptions

  return [
    replace({ preventAssignment: true, ...replaceOptions }),
    typescript({
      tsconfig: './tsconfig.json',
      outputToFilesystem: true,
      exclude: ['**/*.test.*', '**/*.stories.*'],
      include: ['./src/**/*', '../core/**/*', '../lib/**/*'],
      compilerOptions: {
        skipLibCheck: true,
        noEmit: false,
        noImplicitAny: false,
        ignoreDeprecations: '5.0',
        noImplicitReturns: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
        strict: false,
      },
    }),
    resolve({
      preferBuiltins,
      browser,
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
    json(),
    commonjs({ include: [/node_modules/], transformMixedEsModules: true }),
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
      onwarn(warning, warn) {
        if (
          warning.code === 'DYNAMIC_IMPORT' ||
          warning.code === 'CIRCULAR_DEPENDENCY' ||
          warning.message?.includes('this')
        )
          return
        warn(warning)
      },
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
    },
    external,
    plugins: createPlugins({
      preferBuiltins: false,
      browser: true,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('browser'),
      },
    }),
    onwarn(warning, warn) {
      if (
        warning.code === 'DYNAMIC_IMPORT' ||
        warning.code === 'CIRCULAR_DEPENDENCY' ||
        warning.message?.includes('this')
      )
        return
      warn(warning)
    },
  },
  'react-native': {
    input: './src/platforms/react-native/index.ts',
    output: {
      file: './dist/index.react-native.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
    },
    external,
    plugins: createPlugins({
      preferBuiltins: false,
      replaceOptions: {
        'process.env.VULTISIG_PLATFORM': JSON.stringify('react-native'),
        'typeof window': JSON.stringify('undefined'),
      },
    }),
    onwarn(warning, warn) {
      if (
        warning.code === 'DYNAMIC_IMPORT' ||
        warning.code === 'CIRCULAR_DEPENDENCY' ||
        warning.message?.includes('this')
      )
        return
      warn(warning)
    },
  },
  electron: [
    {
      input: './src/platforms/electron-main/index.ts',
      output: {
        file: './dist/index.electron-main.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
        interop: 'auto',
        inlineDynamicImports: true,
      },
      external,
      plugins: createPlugins({
        preferBuiltins: true,
        replaceOptions: {
          'process.env.VULTISIG_PLATFORM': JSON.stringify('electron-main'),
        },
      }),
    },
    {
      input: './src/platforms/electron-renderer/index.ts',
      output: {
        file: './dist/index.electron-renderer.js',
        format: 'es',
        sourcemap: true,
        inlineDynamicImports: true,
      },
      external,
      plugins: createPlugins({
        preferBuiltins: false,
        browser: true,
        replaceOptions: {
          'process.env.VULTISIG_PLATFORM': JSON.stringify('electron-renderer'),
        },
      }),
      onwarn(warning, warn) {
        if (
          warning.code === 'DYNAMIC_IMPORT' ||
          warning.code === 'CIRCULAR_DEPENDENCY' ||
          warning.message?.includes('this')
        )
          return
        warn(warning)
      },
    },
  ],
}

// Export based on target
let exportConfig
if (target === 'all') {
  exportConfig = [...configs.node, configs.browser, configs['react-native'], ...configs.electron]
} else if (configs[target]) {
  const config = configs[target]
  exportConfig = Array.isArray(config) ? config : [config]
} else {
  throw new Error(`Unknown build target: ${target}. Available targets: node, browser, react-native, electron, all`)
}

export default defineConfig(exportConfig)
