// Per-tool handler tests for the new tool-path API:
// each handler takes `(toolCallId, input)` and returns a `RecentAction`.
// Covers the seven live client-side handlers + signTxFromBuffer.
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  const ethereum = Chain.Ethereum
  const bitcoin = Chain.Bitcoin

  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [ethereum, bitcoin],
    isEncrypted: false,
    address: vi.fn().mockResolvedValue('0xsender'),
    addChain: vi.fn().mockResolvedValue(undefined),
    removeChain: vi.fn().mockResolvedValue(undefined),
    addToken: vi.fn().mockResolvedValue(undefined),
    removeToken: vi.fn().mockResolvedValue(undefined),
  } as unknown as VaultBase
}

describe('AgentExecutor — per-tool handlers (new tool-path API)', () => {
  it('add_chain handles single chain', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.addChain('call-1', { chain: 'Ethereum' })

    expect(recent.success).toBe(true)
    expect(recent.tool).toBe('add_chain')
    expect(vault.addChain).toHaveBeenCalledWith(Chain.Ethereum)
    expect(recent.data?.chain).toBe('Ethereum')
    expect(recent.data?.added).toBe(true)
    expect(vault.address).toHaveBeenCalled()
  })

  it('add_chain handles batch chains array', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.addChain('call-2', {
      chains: ['Bitcoin', { chain: 'Ethereum' }],
    })

    expect(recent.success).toBe(true)
    expect(vault.addChain).toHaveBeenCalledTimes(2)
    const added = recent.data?.added as Array<{ chain: string }>
    expect(added).toHaveLength(2)
    expect(added.map(a => a.chain).sort()).toEqual(['Bitcoin', 'Ethereum'])
  })

  it('add_chain returns failure RecentAction on unknown chain', async () => {
    const executor = new AgentExecutor(createMockVault())

    const recent = await executor.addChain('call-3', { chain: 'Atlantis' })

    expect(recent.success).toBe(false)
    expect(recent.tool).toBe('add_chain')
    expect((recent.data as Record<string, unknown>).error).toMatch(/Unknown chain/i)
  })

  it('remove_chain calls vault.removeChain', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.removeChain('call-4', { chain: 'Bitcoin' })

    expect(recent.success).toBe(true)
    expect(recent.tool).toBe('remove_chain')
    expect(vault.removeChain).toHaveBeenCalledWith(Chain.Bitcoin)
    expect(recent.data?.removed).toBe(true)
  })

  it('add_coin handles single token', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.addCoin('call-5', {
      chain: 'Ethereum',
      symbol: 'USDC',
      contract_address: '0xabc',
      decimals: 6,
    })

    expect(recent.success).toBe(true)
    expect(recent.tool).toBe('add_coin')
    expect(vault.addToken).toHaveBeenCalled()
    expect(recent.data?.added).toBe(true)
    expect(recent.data?.symbol).toBe('USDC')
  })

  it('add_coin handles batch tokens array', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.addCoin('call-6', {
      tokens: [
        { chain: 'Ethereum', symbol: 'USDC' },
        { chain: 'Bitcoin', symbol: 'BTC' },
      ],
    })

    expect(recent.success).toBe(true)
    const added = recent.data?.added as Array<{ symbol: string }>
    expect(added).toHaveLength(2)
    expect(vault.addToken).toHaveBeenCalledTimes(2)
  })

  it('remove_coin calls vault.removeToken', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const recent = await executor.removeCoin('call-7', {
      chain: 'Ethereum',
      token_id: '0xabc',
    })

    expect(recent.success).toBe(true)
    expect(vault.removeToken).toHaveBeenCalledWith(Chain.Ethereum, '0xabc')
    expect(recent.data?.removed).toBe(true)
  })

  it('address_book_add returns stub failure RecentAction (not yet implemented locally)', async () => {
    const executor = new AgentExecutor(createMockVault())

    const recent = await executor.addressBookAdd('call-8', {
      address: '0x123',
      chain: 'Ethereum',
    })

    expect(recent.success).toBe(false)
    expect(recent.tool).toBe('address_book_add')
    expect((recent.data as Record<string, unknown>).error).toMatch(/not yet implemented/i)
  })

  it('address_book_remove returns stub failure RecentAction (not yet implemented locally)', async () => {
    const executor = new AgentExecutor(createMockVault())

    const recent = await executor.addressBookRemove('call-9', { address: '0x123' })

    expect(recent.success).toBe(false)
    expect(recent.tool).toBe('address_book_remove')
    expect((recent.data as Record<string, unknown>).error).toMatch(/not yet implemented/i)
  })

  it('signTxFromBuffer returns failure RecentAction when no pending payload exists', async () => {
    const executor = new AgentExecutor(createMockVault())

    const recent = await executor.signTxFromBuffer('tx_sign_test')

    expect(recent.success).toBe(false)
    expect(recent.tool).toBe('sign_tx')
    expect((recent.data as Record<string, unknown>).error).toMatch(/no pending transaction/i)
  })

  it('storeServerTransaction returns false for MCP error payloads', () => {
    const executor = new AgentExecutor(createMockVault())
    const ok = executor.storeServerTransaction({
      tx: { status: 'error', error: 'simulation failed' },
      chain: 'Ethereum',
    })
    expect(ok).toBe(false)
    expect(executor.hasPendingTransaction()).toBe(false)
  })

  it('storeServerTransaction returns true and sets pending for a valid nested tx', () => {
    const executor = new AgentExecutor(createMockVault())
    const ok = executor.storeServerTransaction({
      send_tx: { to: '0xabc', value: '0', data: '0x' },
      chain: 'Ethereum',
    })
    expect(ok).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
  })
})
