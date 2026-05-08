/**
 * Phase B multi-leg sequencer tests.
 *
 * mcp-ts `execute_swap` and `execute_contract_call` may emit a 2-leg
 * envelope carrying both `approvalTxArgs` (ERC-20 approve) and `txArgs`
 * (the main swap/call). sdk-cli's `AgentExecutor` stashes both legs in
 * `pendingLegs` and dispatches `signTxFromBuffer` through the new
 * `signMultiLeg` method, which:
 *   1. signs + broadcasts the approve leg via the existing signServerTx,
 *   2. polls vault.getTxStatus until the approve confirms (or timeout),
 *   3. signs + broadcasts the main leg only after step 2 succeeds.
 *
 * Failure on (1) or (2) MUST hold back the main leg — the swap can't run
 * against a stale or unconfirmed allowance. See task
 * 080526-sdk-cli-multileg-sequencer.md.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.BSC, Chain.Polygon],
    isEncrypted: false,
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'BNB' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

const APPROVE_TX = {
  to: '0xUSDC',
  value: '0',
  data: '0x095ea7b3' + '0'.repeat(120),
  gas_limit: '60000',
}

const SWAP_TX = {
  to: '0xRouter',
  value: '50000000000000000',
  data: '0xdeadbeef',
  gas_limit: '250000',
}

function makeMultiLegEnvelope() {
  return {
    chain: 'BSC',
    from_chain: 'BSC',
    stepperConfig: { flow: 'swap', steps: [] },
    approvalTxArgs: {
      chain: 'BSC',
      chain_id: '56',
      from: '0xsender',
      tx: APPROVE_TX,
    },
    txArgs: {
      chain: 'BSC',
      chain_id: '56',
      from: '0xsender',
      tx: SWAP_TX,
    },
  }
}

describe('AgentExecutor — multi-leg sequencer (Phase B)', () => {
  it('stores 2 legs in order (approve, main) when given a multi-leg envelope', () => {
    const executor = new AgentExecutor(createMockVault())
    const stored = executor.storeServerTransaction(makeMultiLegEnvelope())

    expect(stored).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
    const legs = (executor as any).pendingLegs as Array<{
      kind: 'approve' | 'main'
      txArgs: any
    }>
    expect(legs).toHaveLength(2)
    expect(legs[0].kind).toBe('approve')
    expect(legs[0].txArgs.tx.to).toBe(APPROVE_TX.to)
    expect(legs[1].kind).toBe('main')
    expect(legs[1].txArgs.tx.to).toBe(SWAP_TX.to)
  })

  it('sequences approve before main (signServerTx call order)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const order: string[] = []
    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      order.push(to)
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(signServerTx).toHaveBeenCalledTimes(2)
    expect(order).toEqual([APPROVE_TX.to, SWAP_TX.to])
  })

  it('returns approval_tx_hash + tx_hash on success', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(recent.data?.approval_tx_hash).toBe('0xapprovehash')
    expect(recent.data?.tx_hash).toBe('0xmainhash')
    expect(recent.data?.chain).toBe('BSC')
    expect(recent.data?.status).toBe('pending')
    expect(recent.data?.explorer_url).toBe(`https://bscscan.com/tx/${SWAP_TX.to}`)
  })

  it('fails closed on receipt timeout — main leg never broadcast', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockRejectedValue(
      new Error('approve tx 0xapprovehash not confirmed within 90s')
    )

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    // Approve was attempted, main was NOT.
    expect(signServerTx).toHaveBeenCalledTimes(1)
    const errMsg = (recent.data as any).error as string
    expect(errMsg).toMatch(/0xapprovehash/)
    expect(errMsg).toMatch(/did not confirm/i)
    // pendingLegs cleared so a retry doesn't double-broadcast.
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('fails closed on revert (receipt status === error) — main leg never broadcast', async () => {
    const vault = createMockVault()
    // getTxStatus returns 'error' (revert).
    ;(vault as any).getTxStatus = vi.fn().mockResolvedValue({ status: 'error' })
    const executor = new AgentExecutor(vault)

    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    expect(signServerTx).toHaveBeenCalledTimes(1)
    const errMsg = (recent.data as any).error as string
    expect(errMsg).toMatch(/0xapprovehash/)
    expect(errMsg).toMatch(/reverted/i)
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('single-leg envelope unaffected — pendingLegs stays empty', () => {
    const executor = new AgentExecutor(createMockVault())
    const stored = executor.storeServerTransaction({
      chain: 'Polygon',
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: { to: '0xrecipient', value: '1000000000000000000', data: '0x' },
      },
    })

    expect(stored).toBe(true)
    expect((executor as any).pendingLegs).toHaveLength(0)
    // The stored payload must not be tagged __multiLeg.
    const payload = (executor as any).pendingPayloads.get('latest')?.payload
    expect(payload?.__multiLeg).toBeUndefined()
    expect(payload?.__serverTx).toBe(true)
  })

  it('envelope with sequence_id and no approvalTxArgs unaffected — propagation works', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockResolvedValue({
      tx_hash: '0xsinglehash',
      chain: 'Ethereum',
      status: 'pending',
      explorer_url: 'https://etherscan.io/tx/0xsinglehash',
    })

    // mcp-go Pattern 1 single-leg envelope with sequence_id.
    const stored = executor.storeServerTransaction({
      chain: 'Ethereum',
      sequence_id: 'seq-abc-123',
      tx: { to: '0xrecipient', value: '1000000000000000000', data: '0x' },
    })
    expect(stored).toBe(true)
    expect((executor as any).pendingLegs).toHaveLength(0)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(recent.data?.tx_hash).toBe('0xsinglehash')
    // sequence_id must propagate verbatim so agent-backend can chain leg N+1.
    expect(recent.data?.sequence_id).toBe('seq-abc-123')
    // approval_tx_hash must NOT be set on a single-leg envelope.
    expect(recent.data?.approval_tx_hash).toBeUndefined()
  })

  it('throws on >2 legs (defensive — phase B is exactly 2)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockResolvedValue({
      tx_hash: '0xirrelevant',
      chain: 'BSC',
      status: 'pending',
      explorer_url: '',
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    // First store a real multi-leg envelope so the dispatcher knows about it,
    // then poison pendingLegs with a 3-leg array to trigger the defensive
    // throw inside signTxFromBuffer's __multiLeg branch.
    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)
    ;(executor as any).pendingLegs = [
      { txArgs: { tx: APPROVE_TX }, parent: {}, kind: 'approve' },
      { txArgs: { tx: SWAP_TX }, parent: {}, kind: 'main' },
      { txArgs: { tx: SWAP_TX }, parent: {}, kind: 'main' },
    ]

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    expect((recent.data as any).error).toMatch(/expected 2 pending legs/i)
  })
})
