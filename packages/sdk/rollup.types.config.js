import { defineConfig } from 'rollup'
import dts from 'rollup-plugin-dts'
import ts from 'typescript'

const dtsPluginOptions = {
  compilerOptions: {
    baseUrl: '.',
    paths: {
      '@/*': ['./src/*'],
      '@helpers/*': ['./tests/e2e/helpers/*'],
      '@types': ['./src/types'],
      '@vultisig/core-config': ['../core/config/index.ts'],
      '@vultisig/core-config/*': ['../core/config/*'],
      '@vultisig/lib-utils/*': ['../lib/utils/*'],
      '@vultisig/lib-dkls/*': ['../lib/dkls/*'],
      '@vultisig/lib-mldsa/*': ['../lib/mldsa/*'],
      '@vultisig/lib-schnorr/*': ['../lib/schnorr/*'],
    },
    skipLibCheck: true,
    strict: false,
  },
}

// wallet-core's extensionless deep type path fails under nodenext; `.js` resolves in every mode.
const WALLET_CORE_DEEP_TYPES = '@trustwallet/wallet-core/dist/src/wallet-core'
const walletCoreDeepTypesSpecifier = {
  name: 'wallet-core-deep-types-specifier',
  resolveId: id => (id === WALLET_CORE_DEEP_TYPES ? { id: `${WALLET_CORE_DEEP_TYPES}.js`, external: true } : null),
}

// Core is bundled at runtime, so its types are inlined too, read from each package's `exports` .d.ts.
const BUNDLED_CORE_TYPES = /^@vultisig\/core-(?:chain|mpc)\//
const bundledCoreTypes = {
  name: 'bundled-core-types',
  resolveId(source, importer) {
    if (!importer || !BUNDLED_CORE_TYPES.test(source)) return null
    const { resolvedModule } = ts.resolveModuleName(
      source,
      importer,
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      ts.sys
    )
    const file = resolvedModule?.resolvedFileName
    if (!file?.endsWith('.d.ts'))
      this.error(`${source} (imported by ${importer}) has no built .d.ts; run yarn build:shared`)
    return file
  },
}

const entries = [
  // Main types (platform-agnostic)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // Node.js platform types
  {
    input: 'src/platforms/node/index.ts',
    output: {
      file: 'dist/index.node.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // Electron main process platform types. This entry exposes Electron-specific
  // storage, crypto, and polyfill implementations in addition to the public SDK
  // surface.
  {
    input: 'src/platforms/electron-main/index.ts',
    output: {
      file: 'dist/index.electron-main.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // Browser platform types. Keep this bundle aligned with the browser runtime
  // entry so platform-only storage, crypto, and polyfill exports are visible
  // through both the root browser condition and the explicit subpath.
  {
    input: 'src/platforms/browser/index.ts',
    output: {
      file: 'dist/index.browser.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // Chrome Extension platform types. This entry exposes the extension storage,
  // crypto, and polyfill implementations shipped by the matching runtime bundle.
  {
    input: 'src/platforms/chrome-extension/index.ts',
    output: {
      file: 'dist/index.chrome-extension.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // React Native platform types — RN-specific exports (e.g. keysign) that
  // aren't reachable from src/index.ts because that entry stays platform
  // agnostic. Consumers resolving under the "react-native" export condition
  // (Metro/Expo tsconfig with customConditions) get this file.
  {
    input: 'src/platforms/react-native/index.ts',
    output: {
      file: 'dist/index.react-native.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // RN preamble — side-effect import, no runtime exports. Emits an almost-
  // empty .d.ts so `import '@vultisig/sdk/rn-preamble'` type-checks cleanly.
  {
    input: 'src/platforms/react-native/preamble.ts',
    output: {
      file: 'dist/index.rn-preamble.d.ts',
      format: 'es',
    },
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  // Vite plugin types. The plugin runs in the consumer's build (Node), not in
  // the shipped SDK runtime, so it gets its own tiny type bundle. `vite` is
  // an optional peer dep — keep it external so the emitted `.d.ts` re-exports
  // `import('vite').Plugin` from the consumer's installed version instead of
  // inlining Vite's entire type graph.
  {
    input: 'src/vite/index.ts',
    output: {
      file: 'dist/vite/index.d.ts',
      format: 'es',
    },
    external: ['vite'],
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
]

// Retain one declaration graph so the remaining platform entries share types.
const esmEntries = entries.filter(entry => !entry.output.file.endsWith('.d.cts'))
export default defineConfig([
  {
    input: Object.fromEntries(
      esmEntries.map(entry => [entry.output.file.replace('dist/', '').replace(/\.d\.ts$/, ''), entry.input])
    ),
    output: {
      dir: 'dist',
      format: 'es',
      entryFileNames: '[name].d.ts',
      chunkFileNames: 'chunks/types/[name]-[hash].d.ts',
    },
    external: ['vite'],
    plugins: [walletCoreDeepTypesSpecifier, bundledCoreTypes, dts(dtsPluginOptions)],
  },
  ...entries.filter(entry => entry.output.file.endsWith('.d.cts')),
])
