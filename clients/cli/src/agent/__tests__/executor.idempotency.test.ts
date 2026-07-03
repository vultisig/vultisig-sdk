/**
 * Executor ↔ broadcast-journal integration (audit F1/F14 double-spend guard).
 *
 * Exercises `signTxFromBuffer`'s duplicate check + record against a real
 * on-disk journal (VULTISIG_BROADCAST_JOURNAL_PATH → temp file). The chain-specific signer
 * (`signServerTx`) is stubbed so the test focuses on the guard, not EVM
 * signing mechanics: a first broadcast is recorded, an identical second intent
 * is REFUSED (no second sign), and `--force` overrides.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { computeFingerprint, reserveBroadcast } from '../broadcastJournal'
import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

function sendEnvelope() {
  return {
    chain: 'Ethereum',
    from_chain: 'Ethereum',
    send_tx: { to: '0xrecipient', value: '1000000000000000000', data: '0x' },
  }
}

function multiLegVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.BSC],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'BNB' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

function multiLegEnvelope() {
  return {
    chain: 'BSC',
    from_chain: 'BSC',
    approvalTxArgs: {
      chain: 'BSC',
      chain_id: '56',
      from: '0xsender',
      tx: { to: '0xUSDC', value: '0', data: '0x095ea7b3' },
    },
    txArgs: { chain: 'BSC', chain_id: '56', from: '0xsender', tx: { to: '0xRouter', value: '5', data: '0xdeadbeef' } },
  }
}

let home: string
let savedHome: string | undefined

beforeEach(() => {
  savedHome = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  home = mkdtempSync(join(tmpdir(), 'vultisig-exec-idem-'))
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(home, 'broadcasts.jsonl')
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = savedHome
  rmSync(home, { recursive: true, force: true })
})

describe('AgentExecutor — broadcast idempotency guard', () => {
  it('refuses to re-broadcast an identical intent within the window', async () => {
    const executor = new AgentExecutor(createMockVault())
    const signSpy = vi
      .spyOn(executor as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xfirst', chain: 'Ethereum', status: 'pending' })

    // First broadcast succeeds and is journaled.
    executor.storeServerTransaction(sendEnvelope())
    const first = await executor.signTxFromBuffer('call-1')
    expect(first.success).toBe(true)
    expect(first.data?.tx_hash).toBe('0xfirst')
    expect(signSpy).toHaveBeenCalledTimes(1)

    // A fresh "retry process" builds the SAME intent — must be refused, and the
    // signer must NOT be invoked a second time (no double-send).
    executor.storeServerTransaction(sendEnvelope())
    const second = await executor.signTxFromBuffer('call-2')
    expect(second.success).toBe(false)
    expect(second.data?.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(signSpy).toHaveBeenCalledTimes(1) // still 1 — the duplicate never signed
  })

  it('allows the re-broadcast when --force (setForceBroadcast) is set', async () => {
    const executor = new AgentExecutor(createMockVault())
    const signSpy = vi
      .spyOn(executor as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xforced', chain: 'Ethereum', status: 'pending' })

    executor.storeServerTransaction(sendEnvelope())
    await executor.signTxFromBuffer('call-1')

    executor.setForceBroadcast(true)
    executor.storeServerTransaction(sendEnvelope())
    const second = await executor.signTxFromBuffer('call-2')
    expect(second.success).toBe(true)
    expect(signSpy).toHaveBeenCalledTimes(2) // forced through
  })

  it('does not guard distinct intents', async () => {
    const executor = new AgentExecutor(createMockVault())
    const signSpy = vi
      .spyOn(executor as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xa', chain: 'Ethereum', status: 'pending' })

    executor.storeServerTransaction(sendEnvelope())
    await executor.signTxFromBuffer('call-1')

    // Different recipient → different fingerprint → allowed.
    executor.storeServerTransaction({
      chain: 'Ethereum',
      from_chain: 'Ethereum',
      send_tx: { to: '0xother', value: '1000000000000000000', data: '0x' },
    })
    const second = await executor.signTxFromBuffer('call-2')
    expect(second.success).toBe(true)
    expect(signSpy).toHaveBeenCalledTimes(2)
  })

  it('multi-leg: an approve broadcast whose receipt-wait times out is still journaled, so a retry refuses to re-approve (F14)', async () => {
    // Process A: approve broadcasts, then the 90s receipt-wait times out → the
    // whole sign throws. The approve leg must already be journaled so a fresh
    // retry process can recognise it and NOT re-broadcast the approval.
    const execA = new AgentExecutor(multiLegVault())
    const signA = vi
      .spyOn(execA as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xapprovehash', chain: 'BSC', status: 'pending' })
    vi.spyOn(
      execA as unknown as { waitForEvmReceipt: (...a: unknown[]) => Promise<void> },
      'waitForEvmReceipt'
    ).mockRejectedValue(new Error('receipt timeout'))

    execA.storeServerTransaction(multiLegEnvelope())
    const first = await execA.signTxFromBuffer('call-A')
    expect(first.success).toBe(false) // sign failed on the receipt timeout
    expect(signA).toHaveBeenCalledTimes(1) // only the approve leg broadcast

    // Process B (fresh executor, same vault/owner): the approve intent is now in
    // the journal, so the guard refuses before signing anything.
    const execB = new AgentExecutor(multiLegVault())
    const signB = vi
      .spyOn(execB as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xshouldnothappen', chain: 'BSC', status: 'pending' })

    execB.storeServerTransaction(multiLegEnvelope())
    const retry = await execB.signTxFromBuffer('call-B')
    expect(retry.success).toBe(false)
    expect(retry.data?.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(signB).not.toHaveBeenCalled() // never re-broadcast the approve
  })

  it('refuses when a SIBLING process holds the atomic reservation (TOCTOU — item 1)', async () => {
    // Simulate the cross-process race: contender A has passed the duplicate check
    // and is mid sign+broadcast (holds the reservation) but hasn't recorded a
    // hash yet, so the journal is still empty. Contender B (this executor) must
    // lose the reservation and refuse WITHOUT signing — closing the window where
    // both siblings would otherwise pass the check and both broadcast.
    const executor = new AgentExecutor(createMockVault())
    const signSpy = vi
      .spyOn(executor as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xshouldnothappen', chain: 'Ethereum', status: 'pending' })

    // The fingerprint executor.buildBroadcastIntent derives for sendEnvelope():
    // owner '' (mock vault has no ecdsa key / vaultId), nested send_tx fields.
    const heldByA = reserveBroadcast(
      computeFingerprint({
        owner: '',
        chain: 'Ethereum',
        to: '0xrecipient',
        value: '1000000000000000000',
        data: '0x',
      })
    )

    executor.storeServerTransaction(sendEnvelope())
    const refused = await executor.signTxFromBuffer('call-contended')
    expect(refused.success).toBe(false)
    expect(refused.data?.code).toBe(AgentErrorCode.DUPLICATE_BROADCAST)
    expect(signSpy).not.toHaveBeenCalled() // never signed — no double-send

    // Once A finishes and releases, a retry proceeds normally.
    heldByA.release()
    executor.storeServerTransaction(sendEnvelope())
    const after = await executor.signTxFromBuffer('call-after')
    expect(after.success).toBe(true)
    expect(signSpy).toHaveBeenCalledTimes(1)
  })

  it('namespaces by owner — the same intent from a DIFFERENT vault is not refused', async () => {
    const vaultA = new AgentExecutor(createMockVault(), false, 'pubkey-A')
    vi.spyOn(
      vaultA as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> },
      'signServerTx'
    ).mockResolvedValue({
      tx_hash: '0xa',
      chain: 'Ethereum',
      status: 'pending',
    })
    vaultA.storeServerTransaction(sendEnvelope())
    expect((await vaultA.signTxFromBuffer('call-A')).success).toBe(true)

    // Different vault (different pubkey → different owner) sending the identical
    // intent must NOT be blocked by vault A's broadcast.
    const vaultB = new AgentExecutor(createMockVault(), false, 'pubkey-B')
    const signB = vi
      .spyOn(vaultB as unknown as { signServerTx: (...a: unknown[]) => Promise<unknown> }, 'signServerTx')
      .mockResolvedValue({ tx_hash: '0xb', chain: 'Ethereum', status: 'pending' })
    vaultB.storeServerTransaction(sendEnvelope())
    const bResult = await vaultB.signTxFromBuffer('call-B')
    expect(bResult.success).toBe(true)
    expect(signB).toHaveBeenCalledTimes(1)
  })
})
