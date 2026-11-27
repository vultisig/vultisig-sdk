import { describe, expect, it, vi } from 'vitest'

import { getToolNames, getTools, parseChainToken, resolveChain } from '../src/tools'

function createMockVault() {
  return {
    name: 'TestVault',
    type: 'fast' as const,
    chains: ['Ethereum', 'Bitcoin', 'Cardano'],
    signers: [{ id: 'signer1', publicKey: 'pk1', name: 'Signer 1' }],
    localPartyId: 'local1',
    threshold: 2,
    createdAt: 1700000000000,
    allBalances: vi.fn().mockResolvedValue([{ chain: 'Ethereum', amount: '1.0' }]),
    address: vi.fn().mockResolvedValue('0xabc123'),
    getSupportedSwapChains: vi.fn().mockReturnValue(['Ethereum', 'Bitcoin']),
    send: vi.fn().mockResolvedValue({ dryRun: true, fee: '0.001', total: '1.001' }),
    swap: vi.fn().mockResolvedValue({ dryRun: true, quote: { expectedOutput: '0.05' } }),
    sign: vi.fn(),
    broadcastTx: vi.fn(),
  } as any
}

describe('tool registration', () => {
  it('registers all 7 tools with defi profile', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const names = Object.keys(tools)
    expect(names).toContain('get_balances')
    expect(names).toContain('get_address')
    expect(names).toContain('vault_info')
    expect(names).toContain('supported_chains')
    expect(names).toContain('swap_quote')
    expect(names).toContain('send')
    expect(names).toContain('swap')
    expect(names).toHaveLength(7)
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
    expect(names).toHaveLength(5)
    expect(names).toContain('get_balances')
    expect(names).toContain('get_address')
    expect(names).toContain('vault_info')
    expect(names).toContain('supported_chains')
    expect(names).toContain('swap_quote')
    expect(names).not.toContain('send')
    expect(names).not.toContain('swap')
  })

  it('defi profile has all 7 tools including send and swap', () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')
    const names = Object.keys(tools)
    expect(names).toContain('send')
    expect(names).toContain('swap')
  })

  it('getToolNames returns correct names per profile', () => {
    expect(getToolNames('harness')).toHaveLength(5)
    expect(getToolNames('defi')).toHaveLength(7)
    expect(getToolNames('harness')).not.toContain('send')
    expect(getToolNames('defi')).toContain('send')
  })

  it('defaults to defi when no profile specified', () => {
    const vault = createMockVault()
    const tools = getTools(vault)
    expect(Object.keys(tools)).toHaveLength(7)
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

  it('send converts and forwards selectedUtxos when provided and omits it by default', async () => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')

    await tools.send.handler({
      chain: 'Bitcoin',
      to: 'bc1qrecipient',
      amount: '0.55',
    })
    expect(vault.send).toHaveBeenLastCalledWith({
      chain: 'Bitcoin',
      to: 'bc1qrecipient',
      amount: '0.55',
      symbol: undefined,
      memo: undefined,
      dryRun: true,
    })

    const hashA = 'aa'.repeat(32)
    const hashB = 'bb'.repeat(32)
    await tools.send.handler({
      chain: 'Bitcoin',
      to: 'bc1qrecipient',
      amount: '0.55',
      selectedUtxos: [
        { hash: hashA.toUpperCase(), index: 0, amount: '50000000' },
        { hash: hashB, index: 1, amount: '10000000' },
      ],
      confirmed: true,
    })
    expect(vault.send).toHaveBeenLastCalledWith({
      chain: 'Bitcoin',
      to: 'bc1qrecipient',
      amount: '0.55',
      symbol: undefined,
      memo: undefined,
      selectedUtxos: [
        { hash: hashA, index: 0, amount: 50_000_000n },
        { hash: hashB, index: 1, amount: 10_000_000n },
      ],
      dryRun: false,
    })
  })

  it.each([
    [
      'non-UTXO chain Ethereum',
      'Ethereum',
      [{ hash: 'aa'.repeat(32), index: 0, amount: '1000' }],
      /only supported for UTXO/,
    ],
    [
      'non-UTXO chain Cardano',
      'Cardano',
      [{ hash: 'aa'.repeat(32), index: 0, amount: '1000' }],
      /only supported for UTXO/,
    ],
    ['empty array', 'Bitcoin', [], /at least one UTXO/],
    ['invalid txid', 'Bitcoin', [{ hash: 'not-hex', index: 0, amount: '1000' }], /selectedUtxos\[0\]\.hash/],
    [
      'uint32 overflow index',
      'Bitcoin',
      [{ hash: 'aa'.repeat(32), index: 4294967296, amount: '1000' }],
      /selectedUtxos\[0\]\.index/,
    ],
    ['decimal amount', 'Bitcoin', [{ hash: 'aa'.repeat(32), index: 0, amount: '0.5' }], /selectedUtxos\[0\]\.amount/],
    [
      'int64 overflow amount',
      'Bitcoin',
      [{ hash: 'aa'.repeat(32), index: 0, amount: '9223372036854775808' }],
      /exceeds int64/,
    ],
    [
      'duplicate outpoint',
      'Bitcoin',
      [
        { hash: 'AA'.repeat(32), index: 0, amount: '1000' },
        { hash: 'aa'.repeat(32), index: 0, amount: '1000' },
      ],
      /Duplicate outpoint/,
    ],
  ])('send rejects %s cleanly as MCP errors', async (_label, chain, selectedUtxos, pattern) => {
    const vault = createMockVault()
    const tools = getTools(vault, 'defi')

    const result = await tools.send.handler({
      chain,
      to: 'recipient',
      amount: '0.55',
      selectedUtxos,
    })

    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0].text).error).toMatch(pattern)
    expect(vault.send).not.toHaveBeenCalled()
  })
})

const CHAINS = ['Ethereum', 'Bitcoin', 'Bitcoin-Cash', 'Solana', 'THORChain', 'TerraClassic', 'Base'] as const

describe('resolveChain', () => {
  it('matches exact chain name', () => {
    expect(resolveChain('Ethereum', CHAINS)).toBe('Ethereum')
  })

  it('matches case-insensitively', () => {
    expect(resolveChain('ethereum', CHAINS)).toBe('Ethereum')
    expect(resolveChain('BITCOIN', CHAINS)).toBe('Bitcoin')
    expect(resolveChain('thorchain', CHAINS)).toBe('THORChain')
  })

  it('accepts SDK aliases and IDs within the vault chain set', () => {
    expect(resolveChain('Bitcoin Cash', CHAINS)).toBe('Bitcoin-Cash')
    expect(resolveChain('columbus-5', CHAINS)).toBe('TerraClassic')
    expect(resolveChain('8453', CHAINS)).toBe('Base')
  })

  it('rejects a known SDK chain outside the vault chain set', () => {
    expect(() => resolveChain('999', CHAINS)).toThrow()
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
