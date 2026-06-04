/**
 * Vultisig.createFastVault — skipVerification option contract (issue #161).
 *
 * Pins the agent/automation flow where the email-OTP step is bypassed and
 * the vault is saved + activated in a single call. Mocks FastVault.create
 * because the real keygen needs WASM + the VultiServer round-trip — out of
 * scope for a unit test pinning the branching contract.
 *
 * Coverage:
 *   - default flow (no flag) → returns string (vaultId), vault NOT saved,
 *     vault NOT activated (existing pre-#161 behaviour preserved)
 *   - skipVerification: false → same as default (backwards-compat sanity)
 *   - skipVerification: true → returns FastVault instance, save() called once,
 *     setActiveVault(vaultId) called once, vaultChanged event fired
 *   - persistPending on the skip-verification branch is ignored (no pending
 *     state to persist)
 *   - persistPending on the default branch still works (existing two-step flow)
 */

import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { configureDefaultStorage } from '../../../src/context/defaultStorage'
import { configureWasm } from '../../../src/context/wasmRuntime'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'
import { FastVault } from '../../../src/vault/FastVault'
import { Vultisig } from '../../../src/Vultisig'

// Stub the FastVault.create static so the keygen + serverManager round-trip
// never runs in the test. The branch under test (skipVerification handling)
// lives in Vultisig.createFastVault, AFTER FastVault.create returns.
const SYNTH_VAULT_ID = '02deadbeef0000000000000000000000000000000000000000000000000000dead'

const mockSave = vi.fn().mockResolvedValue(undefined)
const mockSavePending = vi.fn().mockResolvedValue(undefined)

function makeStubVault(): Partial<FastVault> {
  return {
    id: SYNTH_VAULT_ID,
    name: 'StubVault',
    save: mockSave as FastVault['save'],
    savePending: mockSavePending as FastVault['savePending'],
  }
}

// Mock WASM runtime
const mockGetWalletCore = vi.fn().mockResolvedValue({})

describe('Vultisig.createFastVault — skipVerification (#161)', () => {
  let sdk: Vultisig
  let setActiveVaultSpy: ReturnType<typeof vi.spyOn>
  let vaultChangedHandler: ReturnType<typeof vi.fn<(data: { vaultId: string }) => void>>

  beforeEach(() => {
    vi.clearAllMocks()
    mockSave.mockClear()
    mockSavePending.mockClear()

    configureWasm(mockGetWalletCore)
    configureDefaultStorage(() => new MemoryStorage())

    sdk = new Vultisig({
      autoInit: false,
      defaultChains: [Chain.Bitcoin, Chain.Ethereum],
      defaultCurrency: 'USD',
      storage: new MemoryStorage(),
    })

    // Stub FastVault.create AFTER sdk construction so we don't accidentally
    // affect any module-load-time wiring.
    vi.spyOn(FastVault, 'create').mockImplementation(async () => ({
      vault: makeStubVault() as FastVault,
      vaultId: SYNTH_VAULT_ID,
      verificationRequired: true,
    }))

    // Stub setActiveVault on the vault manager so we can observe it without
    // needing the full vault-instance-roundtrip the real implementation does.
    // The expect-toHaveBeenCalledWith assertion is the contract pin.
    setActiveVaultSpy = vi
      .spyOn(sdk['vaultManager'] as { setActiveVault: (id: string) => Promise<void> }, 'setActiveVault')
      .mockResolvedValue(undefined)

    // Capture vaultChanged emissions so we can assert exactly one fires on the
    // skip-verification branch (mirrors the verifyVault post-save emit).
    vaultChangedHandler = vi.fn<(data: { vaultId: string }) => void>()
    sdk.on('vaultChanged', vaultChangedHandler)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sdk.off('vaultChanged', vaultChangedHandler)
  })

  describe('default flow (no flag)', () => {
    it('returns the vaultId string when skipVerification is not set', async () => {
      const result = await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
      })
      expect(typeof result).toBe('string')
      expect(result).toBe(SYNTH_VAULT_ID)
    })

    it('does NOT save the vault on the default branch', async () => {
      await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
      })
      expect(mockSave).not.toHaveBeenCalled()
    })

    it('does NOT activate the vault on the default branch', async () => {
      await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
      })
      expect(setActiveVaultSpy).not.toHaveBeenCalled()
    })

    it('does NOT emit vaultChanged on the default branch', async () => {
      await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
      })
      expect(vaultChangedHandler).not.toHaveBeenCalled()
    })

    it('treats skipVerification: false as the default branch (backwards-compat)', async () => {
      const result = await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
        skipVerification: false,
      })
      expect(typeof result).toBe('string')
      expect(result).toBe(SYNTH_VAULT_ID)
      expect(mockSave).not.toHaveBeenCalled()
      expect(setActiveVaultSpy).not.toHaveBeenCalled()
    })

    it('calls savePending when persistPending is true on the default branch (existing two-step flow)', async () => {
      await sdk.createFastVault({
        name: 'My Vault',
        password: 'pw',
        email: 'a@b.com',
        persistPending: true,
      })
      expect(mockSavePending).toHaveBeenCalledTimes(1)
      expect(mockSave).not.toHaveBeenCalled()
    })
  })

  describe('skipVerification: true (agent / automation)', () => {
    it('returns the FastVault instance directly (not a string)', async () => {
      const result = await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
      })
      // The contract: skipVerification: true → returns the vault, not the id.
      // typeof string would mean the verification-required branch fired.
      expect(typeof result).not.toBe('string')
      expect((result as FastVault).id).toBe(SYNTH_VAULT_ID)
      expect((result as FastVault).name).toBe('StubVault')
    })

    it('saves the vault exactly once before returning', async () => {
      await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
      })
      expect(mockSave).toHaveBeenCalledTimes(1)
    })

    it('activates the new vault exactly once', async () => {
      await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
      })
      expect(setActiveVaultSpy).toHaveBeenCalledTimes(1)
      expect(setActiveVaultSpy).toHaveBeenCalledWith(SYNTH_VAULT_ID)
    })

    it('emits vaultChanged exactly once with the new vault id', async () => {
      await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
      })
      expect(vaultChangedHandler).toHaveBeenCalledTimes(1)
      expect(vaultChangedHandler).toHaveBeenCalledWith({ vaultId: SYNTH_VAULT_ID })
    })

    it('IGNORES persistPending on the skip-verification branch (no pending state to persist)', async () => {
      // persistPending only makes sense for the two-step flow where the vault
      // sits in pendingVaults waiting for verifyVault(). On the skip branch
      // the vault is saved directly, so persistPending is meaningless — it
      // must be a no-op rather than a redundant savePending call.
      await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
        persistPending: true,
      })
      expect(mockSavePending).not.toHaveBeenCalled()
      // save() still fires on this branch.
      expect(mockSave).toHaveBeenCalledTimes(1)
    })

    it('does not require the caller to follow up with verifyVault — the returned vault is fully activated', async () => {
      const vault = (await sdk.createFastVault({
        name: 'CI Vault',
        password: 'pw',
        email: 'ci@example.com',
        skipVerification: true,
      })) as FastVault
      // The returned vault carries the id + name we expect AND the side effects
      // (save + setActiveVault + emit) have all completed by the time the
      // promise resolves. This is the post-condition that #161 demands: a
      // ready-to-use vault, no OTP, no follow-up call required.
      expect(vault.id).toBe(SYNTH_VAULT_ID)
      expect(mockSave).toHaveBeenCalledTimes(1)
      expect(setActiveVaultSpy).toHaveBeenCalledWith(SYNTH_VAULT_ID)
      expect(vaultChangedHandler).toHaveBeenCalledWith({ vaultId: SYNTH_VAULT_ID })
    })
  })
})
