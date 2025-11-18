import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import typescript from '@rollup/plugin-typescript'
import { defineConfig } from 'rollup'
import copy from 'rollup-plugin-copy'

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
  'stream',
  'url',

  // WASM files should be external
  /\.wasm$/,

  // External problematic dependencies
  'tiny-secp256k1',
  '@solana/web3.js',
  '@cosmjs/stargate',
  '@cosmjs/amino',
  '@bufbuild/protobuf',
  'ripple-binary-codec',
]

const plugins = [
  typescript({
    tsconfig: './tsconfig.json',
    outputToFilesystem: true,
    exclude: ['**/*.test.*', '**/*.stories.*'],
    // Include SDK src and workspace packages
    include: ['./src/**/*', '../core/**/*', '../lib/**/*'],
    // Ensure proper module resolution for SDK-specific packages
    compilerOptions: {
      skipLibCheck: true,
      noEmit: false,
      noImplicitAny: false,
      ignoreDeprecations: '5.0',
      // Additional options to handle type compatibility issues
      noImplicitReturns: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      strict: false,
    },
  }),
  resolve({
    preferBuiltins: false,
    browser: true,
    exportConditions: ['browser', 'module', 'import', 'default'],
    skip: [
      'react',
      'react-dom',
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
    dedupe: ['react', 'react-dom'],
    // Skip WASM files
    ignore: [/\.wasm$/],
  }),
  json(),
  commonjs({
    include: [/node_modules/],
    transformMixedEsModules: true,
  }),
]

const wasmCopyPlugin = copy({
  targets: [
    // Copy WASM files to dist/lib for production (published package)
    {
      src: '../lib/dkls',
      dest: './dist/lib',
    },
    {
      src: '../lib/schnorr',
      dest: './dist/lib',
    },
    // Note: ./lib is a symlink to ../lib, so no copy needed for development
    // The symlink provides direct access to packages/lib from packages/sdk/lib
  ],
})

export default defineConfig([
  // ESM build for modern bundlers
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.esm.js',
      format: 'es',
      sourcemap: true,
      // Inline dynamic imports to avoid multi-chunk issues
      inlineDynamicImports: true,
    },
    external,
    plugins: [...plugins, wasmCopyPlugin],
    // Handle dynamic imports and circular dependencies
    onwarn(warning, warn) {
      // Suppress warnings about dynamic imports, WASM, and circular deps
      if (warning.code === 'DYNAMIC_IMPORT') return
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      if (warning.message?.includes('this')) return
      warn(warning)
    },
  },

  // CommonJS build for Node.js environments
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
      interop: 'auto',
      inlineDynamicImports: true,
    },
    external,
    plugins,
  },

  // UMD build for CDN/browser direct usage
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.umd.js',
      format: 'umd',
      name: 'Vultisig',
      sourcemap: true,
      inlineDynamicImports: true,
      globals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        axios: 'axios',
        viem: 'viem',
        zod: 'zod',
        '@trustwallet/wallet-core': 'WalletCore',
        crypto: 'crypto',
        buffer: 'Buffer',
      },
    },
    external,
    plugins: [
      ...plugins,
      terser({
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
        mangle: {
          reserved: ['Vultisig'], // Keep main export name
        },
      }),
    ],
  },

  // Type definitions build has been moved to TypeScript's native tsc
  // See tsconfig.declarations.json and the build:types script
  // This approach is more memory-efficient and reliable for large codebases
])
