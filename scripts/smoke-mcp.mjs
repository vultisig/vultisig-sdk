import { spawnSync } from 'node:child_process'

function runMcp(args) {
  return spawnSync(process.execPath, ['clients/mcp/dist/bin/mcp-server.js', ...args], {
    encoding: 'utf8',
    timeout: 15_000,
  })
}

const result = runMcp(['--help'])

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

if (
  !output.includes('vultisig-mcp') ||
  !output.includes('--profile <harness|defi>') ||
  !output.includes('--vault <id-or-path>')
) {
  process.stderr.write('MCP smoke failed: help output did not include the expected CLI usage.\n')
  process.exit(1)
}

const unknownArgResult = runMcp(['--vault', 'intended-vault', '--unknown-option'])
if (unknownArgResult.status === 0) {
  process.stderr.write('MCP smoke failed: unknown arguments should be rejected.\n')
  process.exit(1)
}

if (!unknownArgResult.stderr.includes('Unknown option "--unknown-option".')) {
  process.stderr.write('MCP smoke failed: unknown argument error was not reported on stderr.\n')
  process.stderr.write(unknownArgResult.stderr ?? '')
  process.stderr.write(unknownArgResult.stdout ?? '')
  process.exit(1)
}
