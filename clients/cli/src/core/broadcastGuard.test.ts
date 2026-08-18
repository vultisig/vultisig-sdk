import { beforeEach, describe, expect, it, vi } from 'vitest'

// The journal is a filesystem-backed module; mock it so we assert guardedBroadcast's
// wiring (which record calls fire, with what args) deterministically, without touching
// disk. The real cosmosDeliverTx matcher stays unmocked — it is the thing under test.
const mocks = vi.hoisted(() => ({
  assertNoRecentDuplicate: vi.fn(),
  computeFingerprint: vi.fn(() => 'fp-under-test'),
  recordBroadcast: vi.fn(),
  recordResolution: vi.fn(),
  release: vi.fn(),
  reserveBroadcast: vi.fn(() => ({ release: mocks.release })),
}))

vi.mock('../agent/broadcastJournal', () => ({
  assertNoRecentDuplicate: mocks.assertNoRecentDuplicate,
  computeFingerprint: mocks.computeFingerprint,
  recordBroadcast: mocks.recordBroadcast,
  recordResolution: mocks.recordResolution,
  reserveBroadcast: mocks.reserveBroadcast,
}))

import type { BroadcastIntent } from '../agent/broadcastJournal'
import { guardedBroadcast } from './broadcastGuard'

const intent: BroadcastIntent = { owner: 'pubkey', chain: 'Cosmos' }

// The wrapped VaultError-shaped message the SDK throws when a cosmos tx is included
// on-chain and then fails execution (cosmjs's assertIsDeliverTxSuccess message, wrapped
// by BroadcastService). The hash is a real 64-hex Cosmos hash — what M2 must journal.
const DELIVERTX_HASH = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6E7F8A9B0C1D2E3F4A5B6C7D8E9F0A1B2'
const deliverTxThrow = () =>
  new Error(
    `Failed to broadcast transaction on Cosmos: Error when broadcasting tx ${DELIVERTX_HASH} at height 1234567. Code: 5; Raw log: insufficient funds`
  )

describe('guardedBroadcast — Cosmos DeliverTx failure journaling (M2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reserveBroadcast.mockReturnValue({ release: mocks.release })
  })

  it('journals the on-chain hash as a FAILED resolution and re-throws', async () => {
    await expect(
      guardedBroadcast(intent, false, async () => {
        throw deliverTxThrow()
      })
    ).rejects.toThrow(/Error when broadcasting tx/)

    // The terminal tx hash cosmjs embedded is journaled...
    expect(mocks.recordBroadcast).toHaveBeenCalledWith('fp-under-test', DELIVERTX_HASH, 'Cosmos')
    // ...and resolved FAILED, which re-opens the guard (the tx is terminal, a
    // fresh-sequence rebuild of this intent is legitimate).
    expect(mocks.recordResolution).toHaveBeenCalledWith(DELIVERTX_HASH, 'failed')
    // The reservation is always released.
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('does not journal a spoofed hash when the intent chain is not Cosmos', async () => {
    // The intent chain is what we control and trust. A NON-Cosmos broadcast whose error
    // text embeds the DeliverTx skeleton (a program-controlled Solana log) must not get an
    // attacker-chosen hash journaled — the intent-chain gate rejects it.
    const solanaIntent: BroadcastIntent = { owner: 'pubkey', chain: 'Solana' }
    await expect(
      guardedBroadcast(solanaIntent, false, async () => {
        throw new Error(
          `Failed to broadcast transaction on Solana: Program log: Error when broadcasting tx ${DELIVERTX_HASH} at height 1. Code: 5; Raw log: gotcha`
        )
      })
    ).rejects.toThrow(/Program log/)

    expect(mocks.recordBroadcast).not.toHaveBeenCalled()
    expect(mocks.recordResolution).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('does not journal anything for a non-DeliverTx broadcast failure', async () => {
    await expect(
      guardedBroadcast(intent, false, async () => {
        throw new Error('Failed to broadcast transaction on Cosmos: request timed out')
      })
    ).rejects.toThrow(/request timed out/)

    expect(mocks.recordBroadcast).not.toHaveBeenCalled()
    expect(mocks.recordResolution).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })

  it('still records the successful hash on the happy path (unchanged behavior)', async () => {
    const result = await guardedBroadcast(intent, false, async () => ({ txHash: 'HAPPY_HASH' }))

    expect(result.txHash).toBe('HAPPY_HASH')
    expect(mocks.recordBroadcast).toHaveBeenCalledWith('fp-under-test', 'HAPPY_HASH', 'Cosmos')
    expect(mocks.recordResolution).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledTimes(1)
  })
})
