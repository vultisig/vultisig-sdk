import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ExitCode } from './core/errors'

const CLI_ENTRY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')

/**
 * A real KEYIMPORT pairing QR (KeygenMessage protobuf, xz-compressed) generated
 * with the SDK's buildKeygenPairingQrPayload — the seedphrase-based session
 * shape whose join flow must fail closed headlessly. Only the payload's
 * SHAPE matters (libType=KEYIMPORT); session values are dummies.
 */
const KEYIMPORT_QR =
  'vultisig://?type=NewVault&tssType=Keygen&jsonData=%2FTd6WFoAAAFpIt42AgAhAQAAAAA3J5fW4ADHAFBdAAUF5m%2FgswO2Dh2pgU7Y54QXkWYv0Wf%2BkNCnaMDwfjOtg2H4ViLnRlVDDZDeHD2D%2FddmQrp6pgSZcQPxu4U2RRgT5Gkw1DhaFZr2MgN%2BExsAAOOxwPQAAWjIAQAAAJWdK0Y%2BMA2LAgAAAAABWVo%3D'

/**
 * Run the CLI in a child process with piped (non-TTY) stdio and empty stdin —
 * the headless invocation this PR fails closed. `-o table` is passed
 * explicitly: piped stdout otherwise auto-defaults to json (silent), which
 * would hide the human-guidance leak this test exists to catch. Vault storage
 * is pointed at a throwaway dir so the run can't touch real state.
 */
function runPiped(args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    VULTISIG_CONFIG_DIR: mkdtempSync(path.join(tmpdir(), 'vsig-join-nontty-')),
  }
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

// Regression for the join-secure KEYIMPORT gap: the action printed
// "This session requires a seedphrase to join." via info() BEFORE
// promptSeedphrase()'s requireInteractive() refused, leaking human guidance
// onto stdout in a headless table-mode session. The guard must fire first.
describe('join secure with a KEYIMPORT QR in a non-TTY session', () => {
  it('fails closed (exit 12) without writing the seedphrase guidance to stdout', () => {
    const res = runPiped(['join', 'secure', '--qr', KEYIMPORT_QR, '-o', 'table'])

    expect(res.status).toBe(ExitCode.CONFIRMATION_REQUIRED)
    // ZERO stdout bytes before the refusal — this covers both the guidance
    // line ("This session requires a seedphrase to join.") and parseKeygenQR's
    // 7z-wasm decompression banner, which is silenced at getSevenZip.
    expect(res.stdout.trim()).toBe('')
    // The typed refusal lands on stderr with the headless escape hatch.
    expect(res.stderr).toMatch(/non-interactive/i)
    expect(res.stderr).toMatch(/--mnemonic/)
  }, 130_000)
})
