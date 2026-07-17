// Shell completion is generated from the real registries (vultisig-sdk sdkcli2-13 P2-13).
//
// Regression guard: completion.ts hand-maintained COMMANDS and CHAINS arrays that had
// drifted. The shipped zsh/bash/fish scripts offered a command list missing
// sign/broadcast/tx-status/execute/discount/agent/auth/delete/join/rujira/add-mldsa,
// and a hand-picked subset of chains. Commands now come from Commander and chains from
// the SDK registry, so the scripts cannot silently go stale again.
import { SUPPORTED_CHAINS } from '@vultisig/sdk'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.ts')

/** Commands that exist in the CLI but were absent from the old hardcoded array. */
const PREVIOUSLY_MISSING = [
  'sign',
  'broadcast',
  'tx-status',
  'execute',
  'discount',
  'agent',
  'auth',
  'delete',
  'join',
  'rujira',
  'add-mldsa',
]

function completionScript(shell: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' }
  // Strip ambient completion env so the run isn't diverted into handleCompletion().
  delete env.COMP_LINE
  delete env.COMP_POINT
  delete env.COMP_CWORD

  const result = spawnSync(process.execPath, ['--import', 'tsx', CLI_ENTRY, 'completion', shell], {
    input: '',
    encoding: 'utf8',
    timeout: 120_000,
    env,
  })
  return result.stdout ?? ''
}

describe('generated completion scripts', () => {
  const shells = ['zsh', 'bash', 'fish'] as const

  for (const shell of shells) {
    describe(shell, () => {
      const script = completionScript(shell)

      it('is non-empty', () => {
        expect(script.trim().length).toBeGreaterThan(0)
      })

      it('offers the commands the hardcoded list had drifted away from', () => {
        for (const cmd of PREVIOUSLY_MISSING) {
          expect(script, `${shell} completion is missing "${cmd}"`).toContain(cmd)
        }
      })

      it('offers chains from the SDK registry, not a hand-picked subset', () => {
        // Cardano and Tron are in the registry but were absent from the old CHAINS array.
        expect(script).toContain('Cardano')
        expect(script).toContain('Tron')
      })

      it('offers every chain the SDK supports', () => {
        for (const chain of SUPPORTED_CHAINS) {
          expect(script, `${shell} completion is missing chain "${chain}"`).toContain(chain)
        }
      })
    })
  }
})
