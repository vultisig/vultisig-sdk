import alias from '@rollup/plugin-alias'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import terser from '@rollup/plugin-terser'
import path from 'path'
import { defineConfig } from 'rollup'
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
  // wasm-bindgen generated JS must be external - bundling breaks externref tables.
  // Matches both the in-monorepo absolute path (`packages/lib/dkls/vs_wasm`) and
  // the bare specifier form we emit via `wasmPathsResolver`
  // (`@vultisig/lib-dkls/vs_wasm`), which lets consumers install the wasm
  // packages as transitive deps and keeps `import.meta.url` pointing at them.
  /(?:^|\/)lib[/-]dkls\/vs_wasm$/,
  /(?:^|\/)lib[/-]mldsa\/vs_wasm$/,
  /(?:^|\/)lib[/-]schnorr\/vs_schnorr_wasm$/,
  '@vultisig/lib-dkls/vs_wasm',
  '@vultisig/lib-mldsa/vs_wasm',
  '@vultisig/lib-schnorr/vs_schnorr_wasm',
  'tiny-secp256k1',
  '@solana/web3.js',
  '@cosmjs/stargate',
  '@cosmjs/amino',
  '@cosmjs/proto-signing',
  '@bufbuild/protobuf',
  'ripple-binary-codec',
  // 7z-wasm uses Emscripten-style WASM loading - must stay external so it can find its .wasm file
  '7z-wasm',
  '@vultisig/mpc-types',
  '@vultisig/mpc-native',
]

// Rewrite WASM import paths for bundled output.
//
// The wasm-bindgen glue must stay external (bundling breaks externref tables)
// AND must be imported via bare specifiers so that:
//
// 1. Consumers install `@vultisig/lib-{dkls,schnorr,mldsa}` as transitive deps
//    (declared in package.json) — no manual wasm copy into `dist/lib/`.
// 2. `new URL('*.wasm', import.meta.url)` inside the glue resolves relative
//    to the published lib package directory, not relative to whatever bundle
//    chunk a downstream bundler emits (e.g. `.vite/deps/@vultisig_sdk.js`).
//
// Paired with the `@vultisig/sdk/vite` plugin which puts the lib packages in
// `optimizeDeps.exclude` so Vite's pre-bundler leaves them adjacent to their
// wasm payloads. Consumers without a bundler (Node ESM) resolve bare
// specifiers directly from node_modules.
const wasmPathsResolver = id => {
  if (id.match(/lib\/dkls\/vs_wasm/)) return '@vultisig/lib-dkls/vs_wasm'
  if (id.match(/lib\/mldsa\/vs_wasm/)) return '@vultisig/lib-mldsa/vs_wasm'
  if (id.match(/lib\/schnorr\/vs_schnorr_wasm/)) return '@vultisig/lib-schnorr/vs_schnorr_wasm'
  return id
}

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
        {
          find: /^@vultisig\/core-chain\/(.*)/,
          replacement: `${path.resolve(currentDir, '../core/chain')}/$1`,
        },
        {
          find: /^@vultisig\/core-mpc\/(.*)/,
          replacement: `${path.resolve(currentDir, '../core/mpc')}/$1`,
        },
        {
          find: /^@vultisig\/core-config$/,
          replacement: path.resolve(currentDir, '../core/config/index.ts'),
        },
        {
          find: /^@vultisig\/core-config\/(.*)/,
          replacement: `${path.resolve(currentDir, '../core/config')}/$1`,
        },
        {
          find: /^@vultisig\/lib-utils\/(.*)/,
          replacement: `${path.resolve(currentDir, '../lib/utils')}/$1`,
        },
        {
          find: /^@vultisig\/lib-dkls\/(.*)/,
          replacement: `${path.resolve(currentDir, '../lib/dkls')}/$1`,
        },
        {
          find: /^@vultisig\/lib-mldsa\/(.*)/,
          replacement: `${path.resolve(currentDir, '../lib/mldsa')}/$1`,
        },
        {
          find: /^@vultisig\/lib-schnorr\/(.*)/,
          replacement: `${path.resolve(currentDir, '../lib/schnorr')}/$1`,
        },
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
        '@cosmjs/proto-signing',
      ],
      ignore: [/\.wasm$/],
    }),
    replace({ preventAssignment: true, ...replaceOptions }),
    esbuild({
      include: ['./src/**/*', '../core/**/*', '../lib/**/*', '../mpc-wasm/**/*', '../mpc-types/**/*'],
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
      plugins: createPlugins({
        preferBuiltins: true,
        replaceOptions: {
          'process.env.VULTISIG_PLATFORM': JSON.stringify('node'),
        },
      }),
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
    },
    // RN externals: native modules, Node builtins, and deps that can't run on RN.
    // Everything else (chain logic, @noble/*, @polkadot/*, @cosmjs/*) is INLINED.
    external: [
      // SDK native modules
      '@vultisig/mpc-types',
      '@vultisig/mpc-native',
      '@vultisig/mpc-wasm',
      '@vultisig/walletcore-native',
      '@react-native-async-storage/async-storage',
      '@trustwallet/wallet-core',
      'expo-crypto',
      // Node builtins — kept external; consumers must map these to
      // empty modules via metro.config.js `resolver.extraNodeModules`.
      // The SDK ships `dist/shims/empty-rn.js` as the canonical target.
      'crypto',
      'buffer',
      'util',
      'url',
      'fs',
      'fs/promises',
      'path',
      'os',
      'http',
      'https',
      'net',
      'tls',
      'zlib',
      'events',
      'child_process',
      'stream',
      'assert',
      'querystring',
      'process',
      // Network transport deps that statically pull Node-only modules via
      // named imports (can't be Proxy-shimmed).
      'rpc-websockets',
      'ws',
      'node-fetch',
      'jayson',
      'jayson/lib/client/browser',
      // Deps that use Node.js or WASM loading (shimmed via alias)
      '7z-wasm',
      'electron',
      // Network/serialization deps (app provides its own)
      'axios',
      'viem',
      'zod',
      'uuid',
      // WASM binaries
      /\.wasm$/,
      /lib\/dkls\/vs_wasm/,
      /lib\/mldsa\/vs_wasm/,
      /lib\/schnorr\/vs_schnorr_wasm/,
    ],
    plugins: [
      alias({
        entries: [
          // Polyfills for Node.js crypto (must come before generic package aliases)
          {
            find: /^@vultisig\/lib-utils\/encryption\/aesGcm\/encryptWithAesGcm$/,
            replacement: path.resolve(currentDir, 'src/platforms/react-native/polyfills/encryptWithAesGcm.ts'),
          },
          {
            find: /^@vultisig\/lib-utils\/encryption\/aesGcm\/decryptWithAesGcm$/,
            replacement: path.resolve(currentDir, 'src/platforms/react-native/polyfills/decryptWithAesGcm.ts'),
          },
          {
            find: /^@vultisig\/core-mpc\/getMessageHash$/,
            replacement: path.resolve(currentDir, 'src/platforms/react-native/polyfills/getMessageHash.ts'),
          },
          {
            find: /\.\.\/getMessageHash$/,
            replacement: path.resolve(currentDir, 'src/platforms/react-native/polyfills/getMessageHash.ts'),
          },
          // Shims for packages that use WASM/Node.js and can't run on RN
          {
            find: /^tiny-secp256k1$/,
            replacement: path.resolve(currentDir, 'src/platforms/react-native/shims/tiny-secp256k1.ts'),
          },
          // Resolve workspace packages to source TS for bundling
          {
            find: /^@vultisig\/core-chain\/(.*)/,
            replacement: path.resolve(currentDir, '../core/chain/$1'),
          },
          {
            find: /^@vultisig\/core-mpc\/(.*)/,
            replacement: path.resolve(currentDir, '../core/mpc/$1'),
          },
          {
            find: /^@vultisig\/core-config(.*)/,
            replacement: path.resolve(currentDir, '../core/config$1'),
          },
          {
            find: /^@vultisig\/lib-utils\/(.*)/,
            replacement: path.resolve(currentDir, '../lib/utils/$1'),
          },
        ],
      }),
      resolve({
        preferBuiltins: false,
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        exportConditions: ['module', 'import', 'default'],
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
      }),
      replace({
        preventAssignment: true,
        'process.env.VULTISIG_PLATFORM': JSON.stringify('react-native'),
        'typeof window': JSON.stringify('undefined'),
      }),
      esbuild({
        include: ['./src/**/*', '../core/**/*', '../lib/**/*'],
        exclude: ['**/*.test.*', '**/node_modules/**'],
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
    ],
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
  // The `@vultisig/sdk/vite` subpath export is a consumer-facing Vite plugin
  // that configures `optimizeDeps.exclude` so the wasm-bindgen glue packages
  // stay adjacent to their `.wasm` payloads at runtime. It runs in the
  // consumer's build (Node), not in the SDK runtime, so it has no runtime
  // deps and ships in both ESM and CJS for maximum tooling compatibility.
  vite: [
    {
      input: './src/vite/index.ts',
      output: {
        file: './dist/vite/index.js',
        format: 'es',
        sourcemap: true,
      },
      // `vite` is a type-only import (declared as an optional peer dep), so it
      // disappears at runtime. Mark it external so Rollup doesn't try to
      // resolve it during the emit.
      external: ['vite'],
      plugins: [
        esbuild({
          include: /\.ts$/,
          target: 'es2022',
          minify: false,
          tsconfig: './tsconfig.json',
        }),
      ],
      onwarn,
    },
    {
      input: './src/vite/index.ts',
      output: {
        file: './dist/vite/index.cjs',
        format: 'cjs',
        sourcemap: true,
        exports: 'named',
      },
      external: ['vite'],
      plugins: [
        esbuild({
          include: /\.ts$/,
          target: 'es2022',
          minify: false,
          tsconfig: './tsconfig.json',
        }),
      ],
      onwarn,
    },
  ],
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
    ...configs.vite,
  ]
} else if (configs[target]) {
  const config = configs[target]
  exportConfig = Array.isArray(config) ? config : [config]
} else {
  throw new Error(
    `Unknown build target: ${target}. Available targets: node, browser, react-native, electron, chrome-extension, vite, all`
  )
}

export default defineConfig(exportConfig)
