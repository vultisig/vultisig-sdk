import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CommandContext } from '../core'
import { ConfirmationRequiredError } from '../core/errors'
import { resetOutput, setNonInteractive } from '../lib/output'
import { executeExecute } from './execute'
import { executeRujiraSwap, executeRujiraWithdraw } from './rujira'
import { executeAddressBook } from './settings'
import { executeSwap } from './swap'
import { executeSend } from './transaction'
import {
  executeCreateFast,
  executeCreateFromSeedphraseFast,
  executeDelete,
  executeExport,
  executeImport,
  executeVerify,
} from './vault-management'

// Regression for PR #1034: the non-TTY fail-closed guard lives at the shared
// prompt chokepoint (src/lib/prompt.ts), so commands that never installed their
// own requireInteractive gate — import / export / verify / address-book — still
// fail closed in a headless session instead of rendering an inquirer prompt onto
// the machine-output channel. Each handler here reaches prompt() with no flag to
// satisfy the value; in non-interactive mode that must throw a typed
// ConfirmationRequiredError (exit 12) and write ZERO bytes to stdout.

// A ctx whose only reachable method before the prompt (executeExport's
// ensureActiveVault) resolves to a dummy vault. Every other member throws if
// touched — proving the guard fires before any real work.
function makeCtx(): CommandContext {
  const trap = () => {
    throw new Error('ctx accessed after the prompt guard should have fired')
  }
  return {
    get sdk(): never {
      return trap()
    },
    getActiveVault: trap,
    setActiveVault: trap,
    ensureActiveVault: async () => ({}) as VaultBase,
    getPassword: trap,
    cachePassword: trap,
    clearPasswordCache: trap,
    isPasswordCached: trap,
    isInteractive: false,
    dispose: () => {},
  } as unknown as CommandContext
}

// A ctx whose ensureActiveVault resolves to a vault that throws on ANY property
// access. The signing commands (send / swap / execute / rujira) must refuse
// up-front — before touching vault.send / vault.swap / vault.address — so
// reaching any vault member proves the fail-closed gate fired too late.
function makeTrapVaultCtx(): CommandContext {
  const trap = () => {
    throw new Error('vault accessed after the fail-closed gate should have fired')
  }
  const vault = new Proxy(
    {},
    {
      get(_target, prop) {
        // `await ctx.ensureActiveVault()` probes `.then` to detect a thenable;
        // let that (and other JS-internal symbol probes) resolve to undefined so
        // only a REAL vault method access trips the trap.
        if (prop === 'then' || typeof prop === 'symbol') return undefined
        return trap()
      },
    }
  ) as unknown as VaultBase
  const ctxTrap = () => {
    throw new Error('ctx accessed after the fail-closed gate should have fired')
  }
  return {
    get sdk(): never {
      return ctxTrap()
    },
    getActiveVault: ctxTrap,
    setActiveVault: ctxTrap,
    ensureActiveVault: async () => vault,
    getPassword: ctxTrap,
    cachePassword: ctxTrap,
    clearPasswordCache: ctxTrap,
    isPasswordCached: ctxTrap,
    isInteractive: false,
    dispose: () => {},
  } as unknown as CommandContext
}

// The human-output helpers in lib/output.ts write to stdout through THREE sinks:
// info/warn/success/printResult → console.log, printTable → console.table, and
// the JSON envelope (outputJson/outputErrorJson) → process.stdout.write. Under
// vitest, console.log/console.table do NOT route through process.stdout.write
// (vitest swaps the global console for its own intercepting stream), so spying
// on process.stdout.write alone would MISS every info/warn/printResult preview —
// exactly the corruption this PR fails closed against. Spy on all three sinks and
// assert none fired, so the "zero stdout bytes before refusal" guarantee is real.
let stdoutSpy: ReturnType<typeof vi.spyOn>
let consoleLogSpy: ReturnType<typeof vi.spyOn>
let consoleTableSpy: ReturnType<typeof vi.spyOn>
const savedEnv = {
  VAULT_PASSWORD: process.env.VAULT_PASSWORD,
  VULTISIG_PASSWORD: process.env.VULTISIG_PASSWORD,
}

beforeEach(() => {
  setNonInteractive(true)
  // No ambient password must satisfy the import/export prompts, or the guarded
  // path would be skipped and the test would prove nothing.
  delete process.env.VAULT_PASSWORD
  delete process.env.VULTISIG_PASSWORD
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {})
})

afterEach(() => {
  resetOutput()
  vi.restoreAllMocks()
  process.env.VAULT_PASSWORD = savedEnv.VAULT_PASSWORD
  process.env.VULTISIG_PASSWORD = savedEnv.VULTISIG_PASSWORD
  if (savedEnv.VAULT_PASSWORD === undefined) delete process.env.VAULT_PASSWORD
  if (savedEnv.VULTISIG_PASSWORD === undefined) delete process.env.VULTISIG_PASSWORD
})

async function expectFailsClosed(run: () => Promise<unknown>): Promise<void> {
  await expect(run()).rejects.toBeInstanceOf(ConfirmationRequiredError)
  try {
    await run()
  } catch (err) {
    const typed = err as ConfirmationRequiredError
    expect(typed.code).toBe('CONFIRMATION_REQUIRED')
    expect(typed.exitCode).toBe(12)
  }
  // Zero bytes to stdout across all three sinks: no JSON envelope, and no
  // info/warn/printResult/printTable preview leaked before the refusal.
  expect(stdoutSpy).not.toHaveBeenCalled()
  expect(consoleLogSpy).not.toHaveBeenCalled()
  expect(consoleTableSpy).not.toHaveBeenCalled()
}

describe('non-interactive prompt fail-closed, per command', () => {
  it('import (encrypted vault password prompt)', async () => {
    await expectFailsClosed(() => executeImport(makeCtx(), '/tmp/does-not-matter.vult'))
  })

  it('export (export-password prompt)', async () => {
    await expectFailsClosed(() => executeExport(makeCtx(), {}))
  })

  it('verify (OTP code prompt)', async () => {
    await expectFailsClosed(() => executeVerify(makeCtx(), 'vault-id', {}))
  })

  it('address-book --add (chain/address/name prompts)', async () => {
    await expectFailsClosed(() => executeAddressBook(makeCtx(), { add: true }))
  })
})

// Regression for the stdout-nonTTY fail-open review finding: flows that keyed
// their behavior off stdin alone could, with a redirected stdout but a TTY
// stdin, create server-side vault state BEFORE the shared prompt chokepoint
// refused. Both must honor the shared non-interactive state instead. stdin is
// stubbed to LOOK like a TTY so a stdin-only check would take the wrong branch.
describe('fast-vault flows honor the shared non-interactive definition (not stdin alone)', () => {
  const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    })
  })

  afterEach(() => {
    if (stdinIsTTY) {
      Object.defineProperty(process.stdin, 'isTTY', stdinIsTTY)
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  })

  it('create (fast) auto-enables two-step and never reaches the OTP prompt', async () => {
    const createFastVault = vi.fn().mockResolvedValue('vault-id-123')
    const ctx = {
      sdk: { createFastVault },
      dispose: () => {},
    } as unknown as CommandContext

    await executeCreateFast(ctx, { name: 'v', password: 'p', email: 'e@x.io' })

    // persistPending:true is the two-step branch — the flow exits pending
    // verification instead of falling through to the interactive OTP loop.
    expect(createFastVault).toHaveBeenCalledWith(expect.objectContaining({ persistPending: true }))
    expect(stdoutSpy).not.toHaveBeenCalled()
  })

  it('import-seedphrase (fast) refuses up-front, before any server-side vault creation', async () => {
    // makeCtx traps every sdk access: reaching validateSeedphrase or
    // createFastVaultFromSeedphrase would throw the trap error, not the typed
    // refusal — so this also proves the guard fires before any side effect.
    await expectFailsClosed(() =>
      executeCreateFromSeedphraseFast(makeCtx(), {
        mnemonic: 'abandon '.repeat(11) + 'about',
        name: 'v',
        password: 'p',
        email: 'e@x.io',
      })
    )
  })
})

// Regression for PR #1034 round 3: the prompt-bound signing/confirmation flows
// (send / swap / execute / rujira swap+withdraw) rendered a human preview to
// stdout BEFORE their non-interactive confirmation refused, corrupting the
// machine-output channel on headless paths. The fail-closed gate must now fire
// up-front — before any preview write and before the vault is touched. Each ctx
// traps every vault member, so reaching vault.send / vault.swap / vault.address
// would throw the trap error instead of the typed ConfirmationRequiredError.
describe('confirmation-bound flows refuse before any stdout preview (non-interactive, no --yes)', () => {
  it('send refuses before vault.send / preview', async () => {
    await expectFailsClosed(() =>
      executeSend(makeTrapVaultCtx(), { chain: Chain.Bitcoin, to: 'bc1qexampleaddress', amount: '1' })
    )
  })

  it('swap refuses before vault.swap / preview', async () => {
    await expectFailsClosed(() =>
      executeSwap(makeTrapVaultCtx(), { fromChain: Chain.Ethereum, toChain: Chain.Bitcoin, amount: 1 })
    )
  })

  it('execute (CosmWasm contract) refuses before vault.address / preview', async () => {
    await expectFailsClosed(() =>
      executeExecute(makeTrapVaultCtx(), {
        chain: Chain.THORChain,
        contract: 'thor1contract',
        msg: '{"swap":{}}',
      })
    )
  })

  it('rujira swap refuses before createRujiraClient / preview', async () => {
    await expectFailsClosed(() =>
      executeRujiraSwap(makeTrapVaultCtx(), { fromAsset: 'THOR.RUNE', toAsset: 'THOR.TCY', amount: '1' })
    )
  })

  it('rujira withdraw refuses before createRujiraClient / preview', async () => {
    await expectFailsClosed(() =>
      executeRujiraWithdraw(makeTrapVaultCtx(), {
        asset: 'THOR.RUNE',
        amount: '1',
        l1Address: '0xdeadbeef',
      })
    )
  })
})

// Regression for PR #1034 round 3: verify --resend printed guidance to stdout and
// delete printed vault details/warnings to stdout BEFORE their interactive
// prompts refused. Both must fail closed before any stdout write.
describe('verify --resend and delete refuse before any stdout write (non-interactive)', () => {
  it('verify --resend (no email/password) refuses before the guidance line', async () => {
    // makeCtx traps every sdk access; the resend path refuses before prompting
    // and before the "Email and password are required..." info write.
    await expectFailsClosed(() => executeVerify(makeCtx(), 'vault-id', { resend: true }))
  })

  it('delete (table mode, no --yes) refuses before the "Vault to delete" block', async () => {
    // ensureActiveVault resolves to a dummy vault; the up-front requireInteractive
    // refuses before any vault property is read for the details block.
    await expectFailsClosed(() => executeDelete(makeTrapVaultCtx(), {}))
  })
})
