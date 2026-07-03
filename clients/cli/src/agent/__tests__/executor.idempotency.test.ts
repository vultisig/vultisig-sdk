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
})
