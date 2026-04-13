import { defineConfig } from 'rollup'
import dts from 'rollup-plugin-dts'

const dtsPluginOptions = {
  compilerOptions: {
    baseUrl: '.',
    paths: {
      '@/*': ['./src/*'],
      '@helpers/*': ['./tests/e2e/helpers/*'],
      '@types': ['./src/types'],
      '@vultisig/core-chain/*': ['../core/chain/*'],
      '@vultisig/core-mpc/*': ['../core/mpc/*'],
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

export default defineConfig([
  // Main types (platform-agnostic)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts(dtsPluginOptions)],
  },
  // Node.js platform types
  {
    input: 'src/platforms/node/index.ts',
    output: {
      file: 'dist/index.node.d.ts',
      format: 'es',
    },
    plugins: [dts(dtsPluginOptions)],
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
    plugins: [dts(dtsPluginOptions)],
  },
])
