#!/usr/bin/env node
import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  external: [
    '@vultisig/sdk',
    'dotenv',
    'chalk',
    'commander',
    'inquirer',
    'ora',
    'cli-table3',
    'tabtab',
    'ws',
  ],
})

console.log(`Built @vultisig/cli v${pkg.version}`)
