// `chains --add` fail-closed validation (vultisig-sdk sdkcli2-08).
//
// Regression guard: an invalid `chains --add <bogus>` used to be persisted to the
// vault's chain list (chain resolution falls back to the raw user string), which
// then threw a stack trace on every subsequent address-deriving command until the
// chain was manually removed. The fix validates against the registry BEFORE
// persisting: an unsupported chain throws INVALID_CHAIN and writes nothing.
import { Chain, SUPPORTED_CHAINS, VaultErrorCode } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InvalidChainError, InvalidInputError } from '../../core'
import { configureOutput, resetOutput } from '../../lib/output'
import { executeAddresses, executeChains } from '../chains'

const MLDSA_ERROR = 'Vault has no MLDSA public key (required for QBTC address derivation)'

function makeVaultAndCtx(initialChains: string[], hasMldsa = true, type: 'fast' | 'secure' = 'fast') {
  const chains = [...initialChains]
  const vault = {
    type,
    get chains() {
      return chains
    },
    addChain: vi.fn(async (chain: string) => {
      chains.push(chain)
    }),
    address: vi.fn(async (chain: string) => `addr-for-${chain}`),
    addresses: vi.fn(async () => ({ Ethereum: '0xabc' })),
    addressesDetailed: vi.fn(async () => ({
      addresses: { Ethereum: '0xabc' },
      failures: hasMldsa
        ? []
        : [
            {
              chain: Chain.QBTC,
              code: VaultErrorCode.AddressDerivationFailed,
              error: MLDSA_ERROR,
            },
          ],
    })),
    getUnderivableChains: vi.fn((requested: Chain[]) =>
      hasMldsa ? [] : requested.filter(chain => chain === Chain.QBTC)
    ),
    removeChain: vi.fn(async () => {}),
    setChains: vi.fn(async (nextChains: string[]) => {
      chains.splice(0, chains.length, ...nextChains)
    }),
  }
  const ctx = {
    ensureActiveVault: vi.fn(async () => vault),
  } as never
  return { vault, ctx }
}

function captureStdout(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    calls.push(String(chunk))
    return true
  })
  return { calls, restore: () => spy.mockRestore() }
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

  it('skips QBTC in --add-all when the vault has no MLDSA key', async () => {
    configureOutput({ format: 'json' })
    const { vault, ctx } = makeVaultAndCtx([], false)
    const out = captureStdout()

    await executeChains(ctx, { addAll: true })
    out.restore()

    expect(vault.setChains).toHaveBeenCalledOnce()
    expect(vault.setChains.mock.calls[0]?.[0]).not.toContain(Chain.QBTC)
    const envelope = JSON.parse(out.calls.join(''))
    expect(envelope.data).toMatchObject({
      added: SUPPORTED_CHAINS.length - 1,
      total: SUPPORTED_CHAINS.length,
      skipped: [
        {
          chain: Chain.QBTC,
          reason: MLDSA_ERROR,
          hint: 'Run "vultisig add-mldsa --email <email>" to add ML-DSA keys to this vault',
        },
      ],
      unavailable: [],
    })
  })

  it('keeps an enabled underivable QBTC chain and reports it as unavailable', async () => {
    configureOutput({ format: 'json' })
    const { vault, ctx } = makeVaultAndCtx([Chain.QBTC], false)
    const out = captureStdout()

    await executeChains(ctx, { addAll: true })
    out.restore()

    expect(vault.setChains).toHaveBeenCalledOnce()
    expect(vault.setChains.mock.calls[0]?.[0]).toContain(Chain.QBTC)
    expect(vault.chains).toContain(Chain.QBTC)
    const envelope = JSON.parse(out.calls.join(''))
    expect(envelope.data.skipped).toEqual([])
    expect(envelope.data.unavailable).toEqual([
      {
        chain: Chain.QBTC,
        reason: MLDSA_ERROR,
        hint: 'Run "vultisig add-mldsa --email <email>" to add ML-DSA keys to this vault',
      },
    ])
  })

  it('includes QBTC in --add-all when the vault has an MLDSA key', async () => {
    configureOutput({ format: 'json' })
    const { vault, ctx } = makeVaultAndCtx([], true)
    const out = captureStdout()

    await executeChains(ctx, { addAll: true })
    out.restore()

    expect(vault.setChains.mock.calls[0]?.[0]).toContain(Chain.QBTC)
    const envelope = JSON.parse(out.calls.join(''))
    expect(envelope.data.skipped).toEqual([])
    expect(envelope.data.unavailable).toEqual([])
  })

  it('does not persist --add-all when the enabled chain list is already complete', async () => {
    const { vault, ctx } = makeVaultAndCtx([...SUPPORTED_CHAINS])

    await executeChains(ctx, { addAll: true })

    expect(vault.setChains).not.toHaveBeenCalled()
  })

  it('rejects --add QBTC before persisting when the vault has no MLDSA key', async () => {
    const { vault, ctx } = makeVaultAndCtx([], false)

    await expect(executeChains(ctx, { add: Chain.QBTC })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      exitCode: 4,
      retryable: false,
    } satisfies Partial<InvalidInputError>)
    expect(vault.addChain).not.toHaveBeenCalled()
  })

  it('returns address failures in JSON through addressesDetailed', async () => {
    configureOutput({ format: 'json' })
    const { vault, ctx } = makeVaultAndCtx([Chain.Ethereum, Chain.QBTC], false)
    const out = captureStdout()

    await executeAddresses(ctx)
    out.restore()

    const envelope = JSON.parse(out.calls.join(''))
    expect(envelope.data).toEqual({
      addresses: { Ethereum: '0xabc' },
      failures: [
        {
          chain: Chain.QBTC,
          error: MLDSA_ERROR,
          hint: 'Run "vultisig add-mldsa --email <email>" to add ML-DSA keys to this vault',
        },
      ],
    })
    expect(vault.addressesDetailed).toHaveBeenCalledOnce()
    expect(vault.addresses).not.toHaveBeenCalled()
  })

  it('uses vault-type-aware ML-DSA hints on every chain command surface', async () => {
    configureOutput({ format: 'json' })
    const { ctx: secureCtx } = makeVaultAndCtx([Chain.QBTC], false, 'secure')
    const addAllOut = captureStdout()
    await executeChains(secureCtx, { addAll: true })
    addAllOut.restore()
    const addAllEnvelope = JSON.parse(addAllOut.calls.join(''))

    const addressesOut = captureStdout()
    await executeAddresses(secureCtx)
    addressesOut.restore()
    const addressesEnvelope = JSON.parse(addressesOut.calls.join(''))

    let addError: InvalidInputError | undefined
    try {
      await executeChains(secureCtx, { add: Chain.QBTC })
    } catch (error) {
      addError = error as InvalidInputError
    }

    const secureHints = [
      addAllEnvelope.data.unavailable[0].hint,
      addressesEnvelope.data.failures[0].hint,
      addError?.hint,
    ]
    expect(secureHints).toEqual([
      'ML-DSA keys can currently be added only to fast vaults, so this secure vault cannot derive QBTC addresses',
      'ML-DSA keys can currently be added only to fast vaults, so this secure vault cannot derive QBTC addresses',
      'ML-DSA keys can currently be added only to fast vaults, so this secure vault cannot derive QBTC addresses',
    ])
    expect(secureHints.every(hint => !hint?.includes('add-mldsa'))).toBe(true)

    const { ctx: fastCtx } = makeVaultAndCtx([Chain.QBTC], false, 'fast')
    const fastOut = captureStdout()
    await executeAddresses(fastCtx)
    fastOut.restore()
    expect(JSON.parse(fastOut.calls.join('')).data.failures[0].hint).toContain('add-mldsa')
  })
})
