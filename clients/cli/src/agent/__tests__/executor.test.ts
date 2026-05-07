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
    addToken: vi.fn().mockResolvedValue(undefined),
    removeToken: vi.fn().mockResolvedValue(undefined),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'ETH' }),
    prepareSendTx: vi.fn().mockResolvedValue({ mockKeysignPayload: true }),
    extractMessageHashes: vi.fn().mockResolvedValue(['0xabc123']),
  } as unknown as VaultBase
}

function createMockVultisig(): ConstructorParameters<typeof AgentExecutor>[3] {
  return {
    addAddressBookEntry: vi.fn().mockResolvedValue(undefined),
    removeAddressBookEntry: vi.fn().mockResolvedValue(undefined),
    getAddressBook: vi.fn().mockResolvedValue({ saved: [], vaults: [] }),
  } as unknown as ConstructorParameters<typeof AgentExecutor>[3]
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

  // vault_chain — agent-backend wire shape: { action, chains: [{chain}] }.
  // The executor also tolerates a single `chain` string for hand-rolled
  // callers (CLI scripts, REPL).
  it('vault_chain action=add with chains array adds each chain', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'vault_chain',
        params: { action: 'add', chains: [{ chain: 'Bitcoin' }, { chain: 'Ethereum' }] },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.addChain).toHaveBeenCalledTimes(2)
    const added = result.data?.added as Array<{ chain: string }>
    expect(added).toHaveLength(2)
    expect(added.map(a => a.chain).sort()).toEqual(['Bitcoin', 'Ethereum'])
  })

  it('vault_chain action=add tolerates single chain shape', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({ type: 'vault_chain', params: { action: 'add', chain: 'Ethereum' } })
    )

    expect(result.success).toBe(true)
    expect(vault.addChain).toHaveBeenCalledWith(Chain.Ethereum)
    expect(result.data?.added).toBe(true)
    expect(result.data?.chain).toBe('Ethereum')
  })

  it('vault_chain action=remove removes each chain in batch', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'vault_chain',
        params: { action: 'remove', chains: [{ chain: 'Bitcoin' }, { chain: 'Ethereum' }] },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.removeChain).toHaveBeenCalledTimes(2)
    const removed = result.data?.removed as Array<{ chain: string }>
    expect(removed.map(r => r.chain).sort()).toEqual(['Bitcoin', 'Ethereum'])
  })

  it('vault_chain rejects unknown action without mutating state', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'vault_chain', params: { action: 'wat' } }))

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/vault_chain.*unknown action/)
    expect(vault.addChain).not.toHaveBeenCalled()
    expect(vault.removeChain).not.toHaveBeenCalled()
  })

  it('vault_coin rejects unknown action without mutating state', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(action({ type: 'vault_coin', params: { action: 'wat', coins: [] } }))

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/vault_coin.*unknown action/)
    expect(vault.addToken).not.toHaveBeenCalled()
    expect(vault.removeToken).not.toHaveBeenCalled()
  })

  // vault_coin — wire shape: { action, coins: [{chain, ticker, contract_address?, decimals?}] }
  it('vault_coin action=add maps coins[] into vault.addToken calls', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'vault_coin',
        params: {
          action: 'add',
          coins: [
            { chain: 'Ethereum', ticker: 'USDC', contract_address: '0xa0b8...eb48', decimals: 6 },
            { chain: 'Bitcoin', ticker: 'BTC' },
          ],
        },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.addToken).toHaveBeenCalledTimes(2)
    const added = result.data?.added as Array<{ chain: string; symbol: string }>
    expect(added.map(a => `${a.chain}:${a.symbol}`).sort()).toEqual(['Bitcoin:BTC', 'Ethereum:USDC'])
  })

  it('vault_coin action=remove uses contract_address as token id', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'vault_coin',
        params: {
          action: 'remove',
          coins: [{ chain: 'Ethereum', ticker: 'USDC', contract_address: '0xa0b8...eb48' }],
        },
      })
    )

    expect(result.success).toBe(true)
    expect(vault.removeToken).toHaveBeenCalledWith(Chain.Ethereum, '0xa0b8...eb48')
  })

  it('vault_coin action=remove rejects coin missing contract_address', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const result = await executor.executeAction(
      action({
        type: 'vault_coin',
        params: { action: 'remove', coins: [{ chain: 'Ethereum', ticker: 'USDC' }] },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/missing contract_address/)
    expect(vault.removeToken).not.toHaveBeenCalled()
  })

  // address_book — wire shape: { action, entry: { name, chain, address } }
  it('address_book action=add forwards to Vultisig.addAddressBookEntry', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'add', entry: { name: 'alice', chain: 'Ethereum', address: '0xalice' } },
      })
    )

    expect(result.success).toBe(true)
    const addFn = (vultisig as any).addAddressBookEntry
    expect(addFn).toHaveBeenCalledOnce()
    const [entries] = addFn.mock.calls[0]
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      chain: Chain.Ethereum,
      address: '0xalice',
      name: 'alice',
      source: 'saved',
    })
    expect(typeof entries[0].dateAdded).toBe('number')
  })

  it('address_book action=remove forwards to Vultisig.removeAddressBookEntry', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'remove', entry: { chain: 'Ethereum', address: '0xalice' } },
      })
    )

    expect(result.success).toBe(true)
    expect((vultisig as any).removeAddressBookEntry).toHaveBeenCalledWith([
      { chain: Chain.Ethereum, address: '0xalice' },
    ])
  })

  // The agent often emits `{chain, name}` without resolving the address.
  // The executor falls back to Vultisig.getAddressBook to look up the
  // address by name so name-based removal works end-to-end.
  it('address_book action=remove resolves address by name when entry.address is missing', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    ;((vultisig as any).getAddressBook as ReturnType<typeof vi.fn>).mockResolvedValue({
      saved: [{ chain: Chain.Ethereum, address: '0xalice', name: 'alice', source: 'saved', dateAdded: 1 }],
      vaults: [],
    })
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'remove', entry: { chain: 'Ethereum', name: 'alice' } },
      })
    )

    expect(result.success).toBe(true)
    expect((vultisig as any).getAddressBook).toHaveBeenCalledWith(Chain.Ethereum)
    expect((vultisig as any).removeAddressBookEntry).toHaveBeenCalledWith([
      { chain: Chain.Ethereum, address: '0xalice' },
    ])
  })

  it('address_book action=remove fails when name does not match any saved entry', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    ;((vultisig as any).getAddressBook as ReturnType<typeof vi.fn>).mockResolvedValue({
      saved: [],
      vaults: [],
    })
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'remove', entry: { chain: 'Ethereum', name: 'alice' } },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no saved entry named "alice"/)
  })

  // Two saved entries with the same name on the same chain are reachable
  // because AddressBookManager dedupes by (chain, address) only. A naive
  // `find()` would silently delete the first match — that's a real
  // data-integrity bug since the user can't tell which entry was removed.
  // Refuse ambiguity instead, listing candidate addresses so the agent
  // can retry with explicit entry.address.
  it('address_book action=remove refuses ambiguous name matches', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    ;((vultisig as any).getAddressBook as ReturnType<typeof vi.fn>).mockResolvedValue({
      saved: [
        { chain: Chain.Ethereum, address: '0xalice1', name: 'alice', source: 'saved', dateAdded: 1 },
        { chain: Chain.Ethereum, address: '0xalice2', name: 'Alice', source: 'saved', dateAdded: 2 },
      ],
      vaults: [],
    })
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'remove', entry: { chain: 'Ethereum', name: 'alice' } },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/ambiguous name "alice"/)
    expect(result.error).toContain('0xalice1')
    expect(result.error).toContain('0xalice2')
    expect((vultisig as any).removeAddressBookEntry).not.toHaveBeenCalled()
  })

  it('address_book rejects unknown action without mutating state', async () => {
    const vault = createMockVault()
    const vultisig = createMockVultisig()
    const executor = new AgentExecutor(vault, false, undefined, vultisig)

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'wat', entry: { name: 'alice', chain: 'Ethereum', address: '0xalice' } },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/address_book.*unknown action/)
    expect((vultisig as any).addAddressBookEntry).not.toHaveBeenCalled()
    expect((vultisig as any).removeAddressBookEntry).not.toHaveBeenCalled()
  })

  it('address_book add fails when Vultisig instance is not configured', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault) // no vultisig

    const result = await executor.executeAction(
      action({
        type: 'address_book',
        params: { action: 'add', entry: { name: 'alice', chain: 'Ethereum', address: '0xalice' } },
      })
    )

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/requires the CLI SDK instance/)
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
