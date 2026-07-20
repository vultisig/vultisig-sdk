// The CLI does not print dependency noise to stderr (vultisig-sdk sdkcli2-13 P1-3).
//
// Regression guard: bigint-buffer console.warn()s at module load when its native
// binding is absent — which it always is, since the package ships no darwin-arm64 (or
// most other) prebuild. Every single invocation, `--version` included, emitted
//   bigint: Failed to load bindings, pure JS will be used (try npm run rebuild?)
// to stderr. The pure-JS fallback works fine and "npm run rebuild" is meaningless for
// a globally installed CLI, so this was pure noise that made a working CLI look broken.
// Silenced via a yarn patch (.yarn/patches/bigint-buffer-*.patch), which the SDK's node
// bundle then inlines.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')

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

describe('stderr cleanliness', () => {
  it('does not warn about bigint bindings on --version', () => {
    const { stderr } = run(['--version'])
    expect(stderr).not.toMatch(/Failed to load bindings/)
  })

  it('leaves stderr completely empty on a successful --version', () => {
    const { stdout, stderr, status } = run(['--version'])
    expect(status).toBe(0)
    expect(stdout).toMatch(/vultisig\//)
    expect(stderr).toBe('')
  })

  it('does not warn about bigint bindings on --help', () => {
    expect(run(['--help']).stderr).not.toMatch(/Failed to load bindings/)
  })

  it('never advises "npm run rebuild", which cannot help a global install', () => {
    const { stdout, stderr } = run(['--version'])
    expect(stdout + stderr).not.toMatch(/npm run rebuild/)
  })
})
