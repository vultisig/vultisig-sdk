import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'
import type { Action } from '../types'

function action(partial: Pick<Action, 'type'> & Partial<Action>): Action {
  return {
    id: partial.id ?? 'a1',
    type: partial.type,
    title: partial.title ?? partial.type,
    params: partial.params,
    auto_execute: partial.auto_execute,
  }
}

function thorVault(): VaultBase {
  const thorchain = Chain.THORChain
  const bitcoin = Chain.Bitcoin

  return {
    name: 'lp-mock',
    id: 'vault-lp',
    type: 'fast',
    chains: [thorchain, bitcoin],
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn(async (c: Chain) => {
      if (c === Chain.THORChain) return 'thor1senderabc'
      if (c === Chain.Bitcoin) return 'bc1qpaired000000000000000000000000000000'
      return 'addr'
    }),
    prepareSendTx: vi.fn().mockResolvedValue({ keysignPayload: true }),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xlphash']),
  } as unknown as VaultBase
}

describe('AgentExecutor THORChain LP', () => {
  const fetchBackup = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = fetchBackup
  })

  it('thorchain_pool_info returns filtered summary when pool is set', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof (input as Request).url === 'string'
              ? (input as Request).url
              : String(input)
      if (url.includes('midgard')) {
        return new Response(
          JSON.stringify([
            {
              asset: 'BTC.BTC',
              status: 'available',
              assetDepth: '1',
              runeDepth: '2',
              liquidityUnits: '3',
              volume24h: '4',
              annualPercentageRate: '0.05',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const executor = new AgentExecutor(thorVault())
    const result = await executor.executeAction(action({ type: 'thorchain_pool_info', params: { pool: 'btc.btc' } }))

    expect(result.success).toBe(true)
    expect(result.data?.found).toBe(true)
    expect((result.data?.summary as { asset: string }).asset).toBe('BTC.BTC')
  })

  it('thorchain_add_liquidity stages prepareSendTx to inbound with LP memo', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof (input as Request).url === 'string'
              ? (input as Request).url
              : String(input)
      if (url.includes('inbound_addresses')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const vault = thorVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'thorchain_add_liquidity',
        params: { pool: 'BTC.BTC', amount: '0.5', auto_pair: false },
      })
    )

    expect(result.success).toBe(true)
    expect((result.data?.memo as string).startsWith('+:BTC.BTC')).toBe(true)
    expect(vault.prepareSendTx).toHaveBeenCalledWith(
      expect.objectContaining({
        receiver: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
        memo: '+:BTC.BTC',
        amount: 50_000_000n,
      })
    )
    expect(executor.hasPendingTransaction()).toBe(true)
  })

  it('thorchain_remove_liquidity uses dust amount and withdraw memo', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof (input as Request).url === 'string'
              ? (input as Request).url
              : String(input)
      if (url.includes('inbound_addresses')) {
        return new Response(JSON.stringify([{ chain: 'AVAX', address: '0x0' }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    const vault = thorVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'thorchain_remove_liquidity',
        params: { pool: 'BTC.BTC', withdraw_percent: 25 },
      })
    )

    expect(result.success).toBe(true)
    expect(result.data?.memo).toBe('-:BTC.BTC:2500')
    expect(vault.prepareSendTx).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 2_000_000n,
        memo: '-:BTC.BTC:2500',
        receiver: 'thor1g98cy3n9mmjrpn0sxmn63lztelera37n8n67c0',
      })
    )
    expect(executor.hasPendingTransaction()).toBe(true)
  })
})
