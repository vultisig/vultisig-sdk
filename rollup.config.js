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
    skip: ['react', 'react-dom', 'axios', 'viem', 'zod', 'uuid', '@trustwallet/wallet-core'],
    // Ensure workspace packages are resolved and bundled
    dedupe: ['react', 'react-dom']
  }),
  commonjs({
    include: [/node_modules/, /\.\.\/core\//, /\.\.\/lib\//]
  }),
  typescript({
    tsconfig: './src/tsconfig.json',
    outputToFilesystem: true,
    exclude: ['**/*.test.*', '**/*.stories.*'],
    // Include workspace packages in compilation
    include: ['src/**/*', '../core/**/*', '../lib/**/*'],
    // Ensure proper module resolution for workspace packages
    compilerOptions: {
      paths: {
        '@core/*': ['../core/*'],
        '@lib/*': ['../lib/*']
      }
    }
  })
]

const wasmCopyPlugin = copy({
  targets: [
    // Copy WASM files to dist for proper loading
    { 
      src: 'lib/dkls/vs_wasm_bg.wasm', 
      dest: 'src/dist/wasm/',
      rename: 'dkls.wasm'
    },
    { 
      src: 'lib/schnorr/vs_schnorr_wasm_bg.wasm', 
      dest: 'src/dist/wasm/',
      rename: 'schnorr.wasm' 
    },
    // wallet-core.wasm will be handled by the consuming application
  ]
})

export default defineConfig([
  // ESM build for modern bundlers
  {
    input: 'src/index.ts',
    output: {
      file: 'src/dist/index.esm.js',
      format: 'es',
      sourcemap: true,
      // Preserve modules for better tree shaking
      preserveModules: false
    },
    external,
    plugins: [...plugins, wasmCopyPlugin],
    // Handle dynamic imports for WASM
    onwarn(warning, warn) {
      // Suppress warnings about dynamic imports for WASM
      if (warning.code === 'DYNAMIC_IMPORT') return
      warn(warning)
    }
  },
  
  // CommonJS build for Node.js environments
  {
    input: 'src/index.ts',
    output: {
      file: 'src/dist/index.js',
      format: 'cjs',
      sourcemap: true,
      exports: 'named',
      interop: 'auto'
    },
    external,
    plugins
  },
  
  // UMD build for CDN/browser direct usage
  {
    input: 'src/index.ts',
    output: {
      file: 'src/dist/index.umd.js',
      format: 'umd',
      name: 'VultisigSDK',
      sourcemap: true,
      globals: {
        'react': 'React',
        'react-dom': 'ReactDOM',
        'axios': 'axios',
        'viem': 'viem',
        'zod': 'zod',
        '@trustwallet/wallet-core': 'WalletCore',
        'crypto': 'crypto',
        'buffer': 'Buffer'
      }
    },
    external,
    plugins: [...plugins, terser({
      compress: {
        drop_console: true,
        drop_debugger: true
      },
      mangle: {
        reserved: ['VultisigSDK'] // Keep main export name
      }
    })]
  },
  
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'src/dist/index.d.ts',
      format: 'es'
    },
    external: [
      ...external,
      // Allow type-only imports
      /^@types\//,
    ],
    plugins: [dts({
      respectExternal: true,
      compilerOptions: {
        preserveSymlinks: false
      }
    })]
  }
])