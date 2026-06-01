import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['clients/mcp/dist/bin/mcp-server.js', '--help'], {
  encoding: 'utf8',
  timeout: 15_000,
})

if (result.error) {
  process.stderr.write(`MCP smoke failed to execute: ${result.error.message}\n`)
  process.exit(1)
}

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '')
  process.stderr.write(result.stdout ?? '')
  process.exit(result.status ?? 1)
}

const output = `${result.stdout}\n${result.stderr}`

if (!output.includes('vultisig-mcp') || !output.includes('--profile <harness|defi>')) {
  process.stderr.write('MCP smoke failed: help output did not include the expected CLI usage.\n')
  process.exit(1)
}
