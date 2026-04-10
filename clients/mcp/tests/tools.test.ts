import { describe, expect, it, vi } from 'vitest'

import { getToolNames, getTools, parseChainToken, resolveChain } from '../src/tools'

function createMockVault() {
  return {
    name: 'TestVault',
    type: 'fast' as const,
    chains: ['Ethereum', 'Bitcoin'],
    signers: [{ id: 'signer1', publicKey: 'pk1', name: 'Signer 1' }],
    localPartyId: 'local1',
    threshold: 2,
    createdAt: 1700000000000,
    allBalances: vi.fn().mockResolvedValue([{ chain: 'Ethereum', amount: '1.0' }]),
    portfolio: vi.fn().mockResolvedValue({
      balances: [{ chain: 'Ethereum', fiatValue: 2000 }],
      totalValue: '2000.00',
      currency: 'usd',
    }),
    address: vi.fn().mockResolvedValue('0xabc123'),
    getSupportedSwapChains: vi.fn().mockReturnValue(['Ethereum', 'Bitcoin']),
    send: vi.fn().mockResolvedValue({ dryRun: true, fee: '0.001', total: '1.001' }),
    swap: vi.fn().mockResolvedValue({ dryRun: true, quote: { expectedOutput: '0.05' } }),
    sign: vi.fn(),
    broadcastTx: vi.fn(),
  } as any
}

describe('tool registration', () => {
  it('registers all 8 tools with defi profile', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const names = Object.keys(tools)
    expect(names).toContain('get_balances')
    expect(names).toContain('get_portfolio')
    expect(names).toContain('get_address')
    expect(names).toContain('vault_info')
    expect(names).toContain('supported_chains')
    expect(names).toContain('swap_quote')
    expect(names).toContain('send')
    expect(names).toContain('swap')
    expect(names).toHaveLength(8)
  })

  it('each tool has description, inputSchema, and handler', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.description, `${name} missing description`).toBeTruthy()
      expect(tool.inputSchema, `${name} missing inputSchema`).toBeTruthy()
      expect(typeof tool.handler, `${name} handler not a function`).toBe('function')
    }
  })
})

describe('profile filtering', () => {
  it('harness profile only has read-only tools', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'harness')
    const names = Object.keys(tools)
    expect(names).toHaveLength(6)
    expect(names).toContain('get_balances')
    expect(names).toContain('get_portfolio')
    expect(names).toContain('get_address')
    expect(names).toContain('vault_info')
    expect(names).toContain('supported_chains')
    expect(names).toContain('swap_quote')
    expect(names).not.toContain('send')
    expect(names).not.toContain('swap')
  })

  it('defi profile has all 8 tools including send and swap', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const names = Object.keys(tools)
    expect(names).toContain('send')
    expect(names).toContain('swap')
  })

  it('getToolNames returns correct names per profile', () => {
    expect(getToolNames('harness')).toHaveLength(6)
    expect(getToolNames('defi')).toHaveLength(8)
    expect(getToolNames('harness')).not.toContain('send')
    expect(getToolNames('defi')).toContain('send')
  })

  it('defaults to defi when no profile specified', () => {
    const vault = createMockVault()
    const tools = getTools(vault)
    expect(Object.keys(tools)).toHaveLength(8)
  })
})

describe('tool handlers', () => {
  it('vault_info returns vault metadata', async () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const result = await tools.vault_info.handler({})
    const data = JSON.parse(result.content[0].text)
    expect(data.name).toBe('TestVault')
    expect(data.type).toBe('fast')
    expect(data.threshold).toBe(2)
  })

  it('get_address calls vault.address', async () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const result = await tools.get_address.handler({ chain: 'Ethereum' })
    const data = JSON.parse(result.content[0].text)
    expect(data.address).toBe('0xabc123')
    expect(vault.address).toHaveBeenCalled()
  })

  it('supported_chains returns chains', async () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const result = await tools.supported_chains.handler({})
    const data = JSON.parse(result.content[0].text)
    expect(data.chains).toEqual(['Ethereum', 'Bitcoin'])
  })

  it('handler wraps errors into error responses', async () => {
    const vault = createMockVault()
    vault.address.mockRejectedValue(new Error('chain not found'))
    const tools = getTools(vault, 'defi')
    const result = await tools.get_address.handler({ chain: 'Ethereum' })
    expect(result.isError).toBe(true)
    const data = JSON.parse(result.content[0].text)
    expect(data.error).toBe('chain not found')
  })

  it('returns content in MCP format', async () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const result = await tools.vault_info.handler({})
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(typeof result.content[0].text).toBe('string')
  })
})

const CHAINS = ['Ethereum', 'Bitcoin', 'Solana', 'THORChain'] as const

describe('resolveChain', () => {
  it('matches exact chain name', () => {
    expect(resolveChain('Ethereum', CHAINS)).toBe('Ethereum')
  })

  it('matches case-insensitively', () => {
    expect(resolveChain('ethereum', CHAINS)).toBe('Ethereum')
    expect(resolveChain('BITCOIN', CHAINS)).toBe('Bitcoin')
    expect(resolveChain('thorchain', CHAINS)).toBe('THORChain')
  })

  it('throws on unknown chain', () => {
    expect(() => resolveChain('FakeChain', CHAINS)).toThrow()
  })
})

describe('parseChainToken', () => {
  it('parses chain-only input', () => {
    expect(parseChainToken('Ethereum', CHAINS)).toEqual({ chain: 'Ethereum', symbol: undefined })
  })

  it('parses chain:token input', () => {
    expect(parseChainToken('Ethereum:USDC', CHAINS)).toEqual({ chain: 'Ethereum', symbol: 'USDC' })
  })

  it('resolves chain case-insensitively', () => {
    expect(parseChainToken('bitcoin', CHAINS)).toEqual({ chain: 'Bitcoin', symbol: undefined })
  })

  it('throws on unknown chain', () => {
    expect(() => parseChainToken('FakeChain:TOKEN', CHAINS)).toThrow()
  })
})
