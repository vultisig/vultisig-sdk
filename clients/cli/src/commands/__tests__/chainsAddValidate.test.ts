// `chains --add` fail-closed validation (vultisig-sdk sdkcli2-08).
//
// Regression guard: an invalid `chains --add <bogus>` used to be persisted to the
// vault's chain list (chain resolution falls back to the raw user string), which
// then threw a stack trace on every subsequent address-deriving command until the
// chain was manually removed. The fix validates against the registry BEFORE
// persisting: an unsupported chain throws INVALID_CHAIN and writes nothing.
import { SUPPORTED_CHAINS } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InvalidChainError } from '../../core'
import { resetOutput } from '../../lib/output'
import { executeChains } from '../chains'

function makeVaultAndCtx(initialChains: string[]) {
  const chains = [...initialChains]
  const vault = {
    get chains() {
      return chains
    },
    addChain: vi.fn(async (chain: string) => {
      chains.push(chain)
    }),
    address: vi.fn(async (chain: string) => `addr-for-${chain}`),
    removeChain: vi.fn(async () => {}),
    setChains: vi.fn(async () => {}),
  }
  const ctx = {
    ensureActiveVault: vi.fn(async () => vault),
  } as never
  return { vault, ctx }
}

describe('chains --add fail-closed validation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetOutput()
  })

  it('rejects an unsupported chain with INVALID_CHAIN and persists nothing', async () => {
    const { vault, ctx } = makeVaultAndCtx([])

    await expect(executeChains(ctx, { add: 'fakechain' as never })).rejects.toBeInstanceOf(InvalidChainError)

    // Nothing was written: no addChain, no address derivation, chain list untouched.
    expect(vault.addChain).not.toHaveBeenCalled()
    expect(vault.address).not.toHaveBeenCalled()
    expect(vault.chains).toEqual([])
  })

  it('carries the offending chain name in the error context', async () => {
    const { ctx } = makeVaultAndCtx([])

    await executeChains(ctx, { add: 'fakechain' as never }).then(
      () => {
        throw new Error('expected executeChains to reject')
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(InvalidChainError)
        expect((err as InvalidChainError).code).toBe('INVALID_CHAIN')
        expect((err as InvalidChainError).context).toMatchObject({ chain: 'fakechain' })
      }
    )
  })

  it('leaves an existing chain list unchanged when a bogus add fails', async () => {
    const existing = SUPPORTED_CHAINS.slice(0, 1)
    const { vault, ctx } = makeVaultAndCtx([...existing])

    await expect(executeChains(ctx, { add: 'notarealchain' as never })).rejects.toBeInstanceOf(InvalidChainError)

    expect(vault.chains).toEqual(existing)
    expect(vault.addChain).not.toHaveBeenCalled()
  })

  it('still adds a valid, supported chain', async () => {
    const valid = SUPPORTED_CHAINS[0]
    const { vault, ctx } = makeVaultAndCtx([])

    await executeChains(ctx, { add: valid })

    expect(vault.addChain).toHaveBeenCalledWith(valid)
    expect(vault.chains).toContain(valid)
  })
})
