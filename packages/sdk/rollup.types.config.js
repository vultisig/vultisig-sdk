import { defineConfig } from 'rollup'
import dts from 'rollup-plugin-dts'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.d.ts',
    format: 'es',
  },
  plugins: [
    dts({
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
    }),
  ],
  external: [
    // Treat imports from core and lib as external to avoid type-checking them
    /^@core\//,
    /^@lib\//,
  ],
})
