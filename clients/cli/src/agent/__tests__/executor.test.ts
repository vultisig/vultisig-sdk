import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'
import type { Action } from '../types'

function createMockVault(): VaultBase {
  const ethereum = Chain.Ethereum
  const bitcoin = Chain.Bitcoin

  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [ethereum, bitcoin],
    balances: vi.fn().mockResolvedValue({
      'Ethereum:ETH': {
        chainId: 'Ethereum',
        symbol: 'ETH',
        formattedAmount: '1.5',
        decimals: 18,
        amount: { toString: () => '1500000000000000000' },
      },
      'Bitcoin:BTC': {
        chainId: 'Bitcoin',
        symbol: 'BTC',
        formattedAmount: '0.1',
        decimals: 8,
        amount: { toString: () => '10000000' },
      },
    }),
    address: vi.fn().mockResolvedValue('0xsender'),
    addChain: vi.fn().mockResolvedValue(undefined),
    removeChain: vi.fn().mockResolvedValue(undefined),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
    prepareSendTx: vi.fn().mockResolvedValue({ mockKeysignPayload: true }),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xabc123']),
  } as unknown as VaultBase
}

function action(partial: Pick<Action, 'type'> & Partial<Action>): Action {
  return {
    id: partial.id ?? 'a1',
    type: partial.type,
    title: partial.title ?? partial.type,
    params: partial.params,
    auto_execute: partial.auto_execute,
  }
}

describe('AgentExecutor', () => {
  it('get_balances maps vault.balances() into balances array', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'get_balances' }))

    expect(result.success).toBe(true)
    expect(vault.balances).toHaveBeenCalledOnce()
    const balances = (result.data?.balances as Array<Record<string, unknown>>) ?? []
    expect(balances).toHaveLength(2)
    expect(balances.map(b => b.symbol).sort()).toEqual(['BTC', 'ETH'])
    expect(balances.find(b => b.symbol === 'ETH')?.amount).toBe('1.5')
  })

  it('get_balances filters by chain', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'get_balances', params: { chain: 'Ethereum' } }))

    expect(result.success).toBe(true)
    const balances = result.data?.balances as Array<{ chain: string }>
    expect(balances).toHaveLength(1)
    expect(balances[0].chain).toBe('Ethereum')
  })

  it('get_balances filters by ticker', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'get_balances', params: { ticker: 'btc' } }))

    expect(result.success).toBe(true)
    const balances = result.data?.balances as Array<{ symbol: string }>
    expect(balances).toHaveLength(1)
    expect(balances[0].symbol).toBe('BTC')
  })

  it('list_vaults returns current vault summary', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'list_vaults' }))

    expect(result.success).toBe(true)
    const vaults = result.data?.vaults as Array<Record<string, unknown>>
    expect(vaults).toHaveLength(1)
    expect(vaults[0].name).toBe('mock-vault')
    expect(vaults[0].id).toBe('vault-mock-1')
    expect(vaults[0].type).toBe('secure')
    expect(vaults[0].chains).toEqual(['Ethereum', 'Bitcoin'])
  })

  it('add_chain handles single chain', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'add_chain', params: { chain: 'Ethereum' } }))

    expect(result.success).toBe(true)
    expect(vault.addChain).toHaveBeenCalledWith(Chain.Ethereum)
    expect(result.data?.chain).toBe('Ethereum')
    expect(result.data?.added).toBe(true)
    expect(vault.address).toHaveBeenCalled()
  })

  it('add_chain handles batch chains array', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'add_chain',
        params: { chains: ['Bitcoin', { chain: 'Ethereum' }] },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.addChain).toHaveBeenCalledTimes(2)
    const added = result.data?.added as Array<{ chain: string }>
    expect(added).toHaveLength(2)
    expect(added.map(a => a.chain).sort()).toEqual(['Bitcoin', 'Ethereum'])
  })

  it('unknown action types return success: false', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'not_a_real_action', id: 'x1' }))

    expect(result.success).toBe(false)
    expect(result.error).toContain('not_a_real_action')
    expect(result.error).toContain('not implemented locally')
  })

  it.each(['get_market_price', 'thorchain_query'] as const)(
    'AUTO_EXECUTE stub %s returns success: false',
    async actionType => {
      const vault = createMockVault()
      const executor = new AgentExecutor(vault)

      const result = await executor.executeAction(action({ type: actionType, params: {} }))

      expect(result.success).toBe(false)
      expect(result.error).toContain(actionType)
      expect(result.error).toContain('not implemented locally')
    }
  )

  it('build_send_tx stores pending payload and returns keysign info', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'build_send_tx',
        params: {
          chain: 'Ethereum',
          ticker: 'ETH',
          to: '0xdestination',
          amount: '0.25',
        },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.prepareSendTx).toHaveBeenCalled()
    expect(vault.extractMessageHashes).toHaveBeenCalled()
    expect(typeof result.data?.keysign_payload).toBe('string')
    expect((result.data?.keysign_payload as string).startsWith('tx_')).toBe(true)
    expect(result.data?.message_hashes).toEqual(['0xabc123'])
    expect(result.data?.destination).toBe('0xdestination')
    expect(result.data?.amount).toBe('0.25')
    expect(executor.hasPendingTransaction()).toBe(true)
  })
})
