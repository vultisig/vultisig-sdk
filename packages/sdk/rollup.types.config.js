import { defineConfig } from 'rollup'
import dts from 'rollup-plugin-dts'

const dtsPluginOptions = {
  respectExternal: true,
  compilerOptions: {
    baseUrl: '.',
    paths: {
      '@/*': ['./src/*'],
      '@helpers/*': ['./tests/e2e/helpers/*'],
      '@types': ['./src/types'],
      '@core/*': ['../core/*'],
      '@lib/*': ['../lib/*'],
    },
    skipLibCheck: true,
    strict: false,
  },
}

const external = [
  // Treat imports from core and lib as external to avoid type-checking them
  /^@core\//,
  /^@lib\//,
]

export default defineConfig([
  // Main types (platform-agnostic)
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es',
    },
    plugins: [dts(dtsPluginOptions)],
    external,
  },
  // Node.js platform types
  {
    input: 'src/platforms/node/index.ts',
    output: {
      file: 'dist/index.node.d.ts',
      format: 'es',
    },
    plugins: [dts(dtsPluginOptions)],
    external,
  },
])
