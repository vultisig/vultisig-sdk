// Shell completion is generated from the real registries (vultisig-sdk sdkcli2-13 P2-13).
//
// Regression guard: completion.ts hand-maintained COMMANDS and CHAINS arrays that had
// drifted. The shipped zsh/bash/fish scripts offered a command list missing
// sign/broadcast/tx-status/execute/discount/agent/auth/delete/join/rujira/add-mldsa,
// and a hand-picked subset of chains. Commands now come from Commander and chains from
// the SDK registry, so the scripts cannot silently go stale again.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SUPPORTED_CHAINS } from '@vultisig/sdk'
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
  // Fail loudly rather than returning '' and letting a "missing X" assertion report
  // the wrong cause.
  if (result.status !== 0) {
    throw new Error(`completion ${shell} exited ${result.status}: ${result.stderr ?? ''}`)
  }
  return result.stdout ?? ''
}

function escapeRe(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
}

/**
 * Whether the script offers `cmd` as its own command token, rather than merely
 * containing it somewhere. A bare substring check would match 'sign' inside a
 * description or inside a longer word, and pass even if the token were absent.
 *
 * Each shell spells its command list differently: zsh emits 'name:description'
 * pairs, bash a space-separated `compgen -W` list, fish `-a "name"`.
 */
function offersCommand(script: string, shell: string, cmd: string): boolean {
  const c = escapeRe(cmd)
  const patterns: Record<string, RegExp> = {
    zsh: new RegExp(`'${c}:`),
    bash: new RegExp(`(^|[\\s"])${c}([\\s"]|$)`, 'm'),
    fish: new RegExp(`__fish_use_subcommand" -a "${c}"`),
  }
  return patterns[shell].test(script)
}

/** Same idea for chains, which every shell emits as a bare space-separated token. */
function offersChain(script: string, shell: string, chain: string): boolean {
  const c = escapeRe(chain)
  const patterns: Record<string, RegExp> = {
    zsh: new RegExp(`(^|[\\s(])${c}([\\s)]|$)`, 'm'),
    bash: new RegExp(`(^|[\\s"])${c}([\\s"]|$)`, 'm'),
    fish: new RegExp(`swap-quote" -a "${c}"`),
  }
  return patterns[shell].test(script)
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
          expect(offersCommand(script, shell, cmd), `${shell} completion does not offer "${cmd}"`).toBe(true)
        }
      })

      it('offers chains from the SDK registry, not a hand-picked subset', () => {
        // Cardano and Tron are in the registry but were absent from the old CHAINS array.
        expect(offersChain(script, shell, 'Cardano')).toBe(true)
        expect(offersChain(script, shell, 'Tron')).toBe(true)
      })

      it('offers every chain the SDK supports', () => {
        for (const chain of SUPPORTED_CHAINS) {
          expect(offersChain(script, shell, chain), `${shell} completion does not offer chain "${chain}"`).toBe(true)
        }
      })
    })
  }
})
