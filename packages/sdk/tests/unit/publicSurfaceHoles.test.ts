import { describe, expect, it } from 'vitest'

import type { NativeSwapChain, NativeSwapChainId } from '@/index'
import type { ChainDiscoveryAggregate, SeedphraseImportPreludeInput, SeedphraseImportPreludeResult } from '@/seedphrase'
// Compile-time half of the proof. A type has no runtime identity, so the thing
// that actually fails when a type is missing from a barrel is `yarn typecheck`,
// not a runtime expect(). These imports are the assertion.
import type { ComputeMaxSendFromBalanceParams } from '@/tools/prep'

// (used inside the #1995 case below so they are real references, not a dead alias)

/**
 * Five separate issues, one shape: a symbol that exists, is already treated as
 * public (a documented return type, a sibling of an exported helper, a
 * canonical the SDK owns), but is not reachable from any published surface.
 *
 * Each case asserts by IDENTITY against the defining module, not just presence,
 * so a barrel that re-exports a local reimplementation instead of the canonical
 * still fails.
 */

describe('sdk#1998 — computeMaxSendFromBalance is reachable from the prep barrel', () => {
  it('exports it alongside its already-public sibling', async () => {
    const prep = await import('@/tools/prep')
    const maxSend = await import('@/tools/prep/maxSend')

    // getMaxSendAmountFromKeys was exported; computeMaxSendFromBalance, defined
    // in the same file and called by the vault path, was not.
    expect(prep.getMaxSendAmountFromKeys).toBe(maxSend.getMaxSendAmountFromKeys)
    expect(prep.computeMaxSendFromBalance).toBe(maxSend.computeMaxSendFromBalance)
  })

  it('reaches the root entry too', async () => {
    const root = await import('@/index')
    const maxSend = await import('@/tools/prep/maxSend')
    expect((root as Record<string, unknown>).computeMaxSendFromBalance).toBe(maxSend.computeMaxSendFromBalance)
  })
})

describe('sdk#1995 — ChainDiscoveryAggregate is exported as a public type', () => {
  // A type has no runtime identity, so the runtime assertion available is that
  // its siblings are all present; the real proof is the compile-time import
  // below, which fails typecheck if the type is not exported.
  it('sits alongside the other chain-discovery types it is returned with', async () => {
    // These bindings are the assertion: if any of these types is not exported
    // from its barrel, this file does not COMPILE, and `yarn typecheck` names
    // the exact missing member. The runtime expects below are incidental.
    const aggregate = null as unknown as ChainDiscoveryAggregate
    const preludeInput = null as unknown as SeedphraseImportPreludeInput
    const preludeResult = null as unknown as SeedphraseImportPreludeResult
    const maxSendParams = null as unknown as ComputeMaxSendFromBalanceParams
    const swapChain = null as unknown as NativeSwapChain
    const swapChainId = null as unknown as NativeSwapChainId
    void [aggregate, preludeInput, preludeResult, maxSendParams, swapChain, swapChainId]

    const { ChainDiscoveryService } = await import('@/seedphrase/ChainDiscoveryService')
    expect(typeof ChainDiscoveryService).toBe('function')
  })
})

describe('sdk#1955 — prepareSeedphraseImportPrelude is reachable', () => {
  it('exports the prelude both seedphrase-import services run first', async () => {
    const seedphrase = await import('@/seedphrase')
    const prelude = await import('@/seedphrase/prepareSeedphraseImportPrelude')

    expect(seedphrase.prepareSeedphraseImportPrelude).toBe(prelude.prepareSeedphraseImportPrelude)
    expect(typeof seedphrase.prepareSeedphraseImportPrelude).toBe('function')
  })
})

describe('sdk#1988 — native-swap metadata is on the root surface', () => {
  it.each([
    'nativeSwapChains',
    'nativeSwapEnabledChainsRecord',
    'nativeSwapChainIds',
    'getNativeSwapChainId',
    'getNativeSwapChainIdFromDenomPrefix',
  ] as const)('re-exports %s by identity', async name => {
    const root = (await import('@/index')) as Record<string, unknown>
    const canonical = (await import('@vultisig/core-chain/swap/native/NativeSwapChain')) as Record<string, unknown>

    expect(root[name]).toBe(canonical[name])
  })

  // The value matters as much as the presence: consumers keep local ticker
  // tables precisely because they cannot import this one.
  it('carries the live THOR/Maya contract, not a placeholder', async () => {
    const root = await import('@/index')
    expect(root.nativeSwapChains).toEqual(['THORChain', 'MayaChain'])
    expect(root.getNativeSwapChainId('THORChain')).toBeTruthy()
  })
})
