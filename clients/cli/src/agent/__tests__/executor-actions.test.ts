import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function minimalVault(): VaultBase {
  return {
    publicKeys: { ecdsa: '0xtestpub' },
    name: 'm',
    id: 'id',
    type: 'fast',
    chains: [Chain.Ethereum],
    isEncrypted: false,
    portfolio: vi.fn().mockResolvedValue({
      balances: [
        {
          amount: '1000000000000000000',
          formattedAmount: '1',
          decimals: 18,
          symbol: 'ETH',
          chainId: 'Ethereum',
          fiatValue: 100,
          fiatCurrency: 'usd',
        },
      ],
      totalValue: '100.00',
      currency: 'usd',
    }),
  } as unknown as VaultBase
}

describe('AgentExecutor agent actions', () => {
  it('get_portfolio returns totalValue and fiatValue from vault.portfolio', async () => {
    const vault = minimalVault()
    const ex = new AgentExecutor(vault, false, undefined, undefined)
    const r = await ex.executeAction({
      id: '1',
      type: 'get_portfolio',
      title: 't',
      description: 'd',
      params: { currency: 'USD' },
    })
    expect(r.success).toBe(true)
    const d = r.data as { totalValue: string; balances: Array<{ fiatValue?: number; symbol: string }> }
    expect(d.totalValue).toBe('100.00')
    expect(d.balances[0].fiatValue).toBe(100)
    expect(d.balances[0].symbol).toBe('ETH')
    expect(vault.portfolio).toHaveBeenCalled()
  })

  it('search_token returns registry matches for Ethereum', async () => {
    const ex = new AgentExecutor(minimalVault(), false, undefined, undefined)
    const r = await ex.executeAction({
      id: '1',
      type: 'search_token',
      title: 't',
      description: 'd',
      params: { query: 'USDC', chain: 'Ethereum' },
    })
    expect(r.success).toBe(true)
    const tokens = (r.data as { tokens: Array<{ ticker: string }> }).tokens
    expect(tokens.length).toBeGreaterThan(0)
    expect(tokens.some(t => t.ticker.toUpperCase().includes('USDC'))).toBe(true)
  })

  it('get_address_book fails with clear error when vultisig is not configured', async () => {
    const ex = new AgentExecutor(minimalVault(), false, undefined, undefined)
    const r = await ex.executeAction({
      id: '1',
      type: 'get_address_book',
      title: 't',
      description: 'd',
    })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/SDK instance|vultisig/i)
  })

  it('storeServerTransaction returns false for MCP error payloads', () => {
    const ex = new AgentExecutor(minimalVault(), false, undefined, undefined)
    const ok = ex.storeServerTransaction({
      tx: { status: 'error', error: 'simulation failed' },
      chain: 'Ethereum',
    })
    expect(ok).toBe(false)
    expect(ex.hasPendingTransaction()).toBe(false)
  })

  it('storeServerTransaction returns true and sets pending for a valid nested tx', () => {
    const ex = new AgentExecutor(minimalVault(), false, undefined, undefined)
    const ok = ex.storeServerTransaction({
      send_tx: { to: '0xabc', value: '0', data: '0x' },
      chain: 'Ethereum',
    })
    expect(ok).toBe(true)
    expect(ex.hasPendingTransaction()).toBe(true)
  })
})
