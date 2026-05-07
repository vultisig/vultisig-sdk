/**
 * Regression tests for tx_ready envelope shape compatibility.
 *
 * Two MCP servers emit different envelope shapes for signable
 * transactions:
 *   - mcp-go (build_*) — top-level `swap_tx` / `send_tx` / `tx`
 *   - mcp-ts (execute_*) — nested `txArgs.tx`
 *
 * sdk-cli must accept all four shapes for single-tx flows
 * (execute_send / execute_contract_call / build_evm_tx /
 * build_swap_tx / build_*_send) and reject mcp-ts's multi-leg
 * `execute_swap` envelope (carries `approvalTxArgs`) until the
 * Phase B sequencing work lands.
 *
 * See task 070526-sdk-cli-mcp-ts-envelope-parity.md.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor, extractNestedTx } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Polygon],
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
  } as unknown as VaultBase
}

const SAMPLE_TX = {
  to: '0x000000000000000000000000000000000000dEaD',
  value: '50000000000000000',
  data: '0x',
  gas_limit: '21000',
  max_fee_per_gas: '227524205642',
  max_priority_fee_per_gas: '26700731074',
  nonce: '60',
}

describe('extractNestedTx', () => {
  it('finds top-level `tx` (mcp-go build_evm_tx)', () => {
    expect(extractNestedTx({ chain: 'Ethereum', tx: SAMPLE_TX })).toBe(SAMPLE_TX)
  })

  it('finds top-level `send_tx` (mcp-go build_*_send)', () => {
    expect(extractNestedTx({ chain: 'Bitcoin', send_tx: SAMPLE_TX })).toBe(SAMPLE_TX)
  })

  it('finds top-level `swap_tx` (mcp-go build_swap_tx)', () => {
    expect(extractNestedTx({ chain: 'Ethereum', swap_tx: SAMPLE_TX })).toBe(SAMPLE_TX)
  })

  it('finds nested `txArgs.tx` (mcp-ts execute_send / execute_contract_call)', () => {
    const env = {
      chain: 'Polygon',
      txArgs: { chain: 'Polygon', chain_id: '137', from: '0xabc', tx: SAMPLE_TX },
    }
    expect(extractNestedTx(env)).toBe(SAMPLE_TX)
  })

  it('returns undefined when no recognized shape is present', () => {
    expect(extractNestedTx({ chain: 'Ethereum' })).toBeUndefined()
    expect(extractNestedTx(null)).toBeUndefined()
    expect(extractNestedTx(undefined)).toBeUndefined()
  })

  it('prefers top-level keys over nested when both are present', () => {
    const topLevel = { ...SAMPLE_TX, to: '0xtop' }
    const nested = { ...SAMPLE_TX, to: '0xnested' }
    const env = { tx: topLevel, txArgs: { tx: nested } }
    expect(extractNestedTx(env)).toBe(topLevel)
  })
})

describe('AgentExecutor.storeServerTransaction', () => {
  function makeExecutor(): AgentExecutor {
    return new AgentExecutor(createMockVault())
  }

  it('stores mcp-go top-level `tx` envelope', () => {
    const executor = makeExecutor()
    const stored = executor.storeServerTransaction({
      chain: 'Ethereum',
      tx: SAMPLE_TX,
    })
    expect(stored).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
  })

  it('stores mcp-go top-level `send_tx` envelope', () => {
    const executor = makeExecutor()
    expect(executor.storeServerTransaction({ chain: 'Bitcoin', send_tx: SAMPLE_TX })).toBe(true)
  })

  it('stores mcp-go top-level `swap_tx` envelope', () => {
    const executor = makeExecutor()
    expect(executor.storeServerTransaction({ chain: 'Ethereum', swap_tx: SAMPLE_TX })).toBe(true)
  })

  it('stores mcp-ts nested `txArgs.tx` envelope (execute_send)', () => {
    const executor = makeExecutor()
    const env = {
      chain: 'Polygon',
      from_chain: 'Polygon',
      resolved: { labels: { resolved_amount: '0.05 POL' } },
      stepperConfig: { flow: 'send', steps: [] },
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: SAMPLE_TX,
      },
    }
    expect(executor.storeServerTransaction(env)).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
  })

  it('stores mcp-ts nested `txArgs.tx` envelope (execute_contract_call)', () => {
    const executor = makeExecutor()
    const env = {
      chain: 'Polygon',
      stepperConfig: { flow: 'contract_call', steps: [] },
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: { ...SAMPLE_TX, value: '0', data: '0x095ea7b3' + '0'.repeat(120) },
      },
    }
    expect(executor.storeServerTransaction(env)).toBe(true)
  })

  it('rejects mcp-ts execute_swap multi-leg envelope (approvalTxArgs present)', () => {
    const executor = makeExecutor()
    const env = {
      chain: 'BSC',
      from_chain: 'BSC',
      stepperConfig: { flow: 'swap', steps: [] },
      approvalTxArgs: {
        chain: 'BSC',
        chain_id: '56',
        from: '0xsender',
        tx: { ...SAMPLE_TX, to: '0xUSDC', value: '0', data: '0x095ea7b3' },
      },
      txArgs: {
        chain: 'BSC',
        chain_id: '56',
        from: '0xsender',
        tx: SAMPLE_TX,
      },
    }
    expect(executor.storeServerTransaction(env)).toBe(false)
    expect(executor.hasPendingTransaction()).toBe(false)
  })

  it('rejects empty / null payloads', () => {
    const executor = makeExecutor()
    expect(executor.storeServerTransaction({})).toBe(false)
    expect(executor.storeServerTransaction(null as any)).toBe(false)
    expect(executor.storeServerTransaction(undefined as any)).toBe(false)
  })

  it('rejects payloads with explicit error in nested tx', () => {
    const executor = makeExecutor()
    expect(
      executor.storeServerTransaction({
        chain: 'Ethereum',
        tx: { status: 'error', error: 'no liquidity' },
      })
    ).toBe(false)
  })
})
