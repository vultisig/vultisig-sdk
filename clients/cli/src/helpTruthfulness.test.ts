import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD
  return spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    input: '',
    encoding: 'utf8',
    timeout: 120_000,
    env,
  })
}

describe('transaction help matches non-interactive behavior', () => {
  it.each([
    ['send', 'Send tokens to an address.'],
    ['swap', 'Swap tokens between chains.'],
  ])('%s explains both preview paths and explicit execution', (command, summary) => {
    const result = run([command, '--help'])
    const help = result.stdout.replace(/\s+/g, ' ')

    expect(result.status).toBe(0)
    expect(help).toContain(
      `${summary} Interactive sessions preview by default; non-interactive sessions require --dry-run to preview or --confirm to execute.`
    )
    expect(help).toContain('Confirm and broadcast (required to execute non-interactively; use --dry-run to preview)')
  })
})

describe('addresses help matches the command signature', () => {
  it('describes the collection and advertises no chain argument', () => {
    const helpResult = run(['addresses', '--help'])

    expect(helpResult.status).toBe(0)
    expect(helpResult.stdout).toContain('Show wallet addresses')
    expect(helpResult.stdout).toMatch(/^Usage: vultisig addresses \[options\]$/m)
    expect(helpResult.stdout).not.toContain('<chain>')

    const rejectedArgument = run(['addresses', 'Ethereum'])

    expect(rejectedArgument.status).not.toBe(0)
    expect(rejectedArgument.stderr).toContain(
      "error: too many arguments for 'addresses'. Expected 0 arguments but got 1"
    )
  })
})
