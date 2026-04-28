#!/usr/bin/env node
import { readFileSync } from 'fs'
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))

await build({
  entryPoints: ['src/index.ts', 'bin/mcp-server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  define: {
    __MCP_VERSION__: JSON.stringify(pkg.version),
  },
  external: [
    '@vultisig/sdk',
    '@vultisig/client-shared',
    '@modelcontextprotocol/sdk',
    '@napi-rs/keyring',
    'inquirer',
    'zod',
  ],
})

console.log(`Built @vultisig/mcp v${pkg.version}`)
