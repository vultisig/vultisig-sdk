// The `tokens` / `swap-quote` CALL SITES validate their chain argument
// (vultisig-sdk sdkcli2-13 P2-6 / P2-10).
//
// core/chain-resolver.test.ts covers the helper in isolation — but the reported bug
// lived at the call sites (`findChainByName(x) || (x as Chain)`), so that file stays
// green even if the call sites regress. This drives the real CLI end-to-end instead:
//   tokens bogus-chain      -> was exit 0 + {"success":true,"data":{"tokens":[]}}
//   swap-quote bogus-chain  -> was exit 7 + a raw "reading 'ticker'" TypeError
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ExitCode } from '../../core/errors'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.ts')

function run(args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
    input: '',
    encoding: 'utf8',
    timeout: 120_000,
    env,
  })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

describe('tokens <chain> validation', () => {
  it('rejects an unknown chain with INVALID_CHAIN / exit 4 instead of an empty success', () => {
    const { status, stdout } = run(['tokens', 'bogus-chain', '-o', 'json'])

    expect(status).toBe(ExitCode.INVALID_INPUT)
    const parsed = JSON.parse(stdout)
    expect(parsed.success).toBe(false)
    expect(parsed.error.code).toBe('INVALID_CHAIN')
  })

  it('never reports success:true with an empty token list for a chain that does not exist', () => {
    const { stdout } = run(['tokens', 'bogus-chain', '-o', 'json'])

    expect(stdout).not.toMatch(/"success":\s*true/)
  })
})

describe('swap-quote <fromChain> <toChain> validation', () => {
  it('rejects an unknown source chain with INVALID_CHAIN / exit 4, not a raw TypeError', () => {
    const { status, stdout } = run(['swap-quote', 'bogus-chain', 'Bitcoin', '1', '-o', 'json'])

    expect(status).toBe(ExitCode.INVALID_INPUT)
    const parsed = JSON.parse(stdout)
    expect(parsed.error.code).toBe('INVALID_CHAIN')
    expect(parsed.error.message).not.toMatch(/Cannot read properties of undefined/)
  })

  it('rejects an unknown destination chain too, and says which side was wrong', () => {
    const { status, stdout } = run(['swap-quote', 'Ethereum', 'bogus-chain', '1', '-o', 'json'])

    expect(status).toBe(ExitCode.INVALID_INPUT)
    expect(JSON.parse(stdout).error.message).toMatch(/destination chain/)
  })

  it('emits exactly one parseable JSON document', () => {
    const { stdout } = run(['swap-quote', 'bogus-chain', 'Bitcoin', '1', '-o', 'json'])

    expect(() => JSON.parse(stdout)).not.toThrow()
  })
})
