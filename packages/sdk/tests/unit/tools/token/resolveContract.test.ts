import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── mocks ─────────────────────────────────────────────────────────────────────
// Mock the RPC/HTTP boundaries so the test exercises pure decoding/validation
// logic deterministically (no live network).

const evmReadContract = vi.fn()
const evmCall = vi.fn()
vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ readContract: evmReadContract, call: evmCall }),
}))

const queryUrl = vi.fn()
vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => queryUrl(...args),
}))

const getParsedAccountInfo = vi.fn()
vi.mock('@vultisig/core-chain/chains/solana/client', () => ({
  getSolanaClient: () => ({ getParsedAccountInfo }),
}))

import { resolveContract } from '@/tools/token/resolveContract'

// ABI-encoded dynamic string: offset-word(0x20) + length-word + data-word.
const abiString = (s: string): `0x${string}` => {
  const hex = Buffer.from(s, 'utf-8').toString('hex')
  const offsetWord = (32).toString(16).padStart(64, '0')
  const lenWord = s.length.toString(16).padStart(64, '0')
  const dataWord = hex.padEnd(64, '0')
  return `0x${offsetWord}${lenWord}${dataWord}` as `0x${string}`
}

// Legacy bytes32 (MKR style): right-padded with nulls, no offset/length.
const bytes32String = (s: string): `0x${string}` =>
  `0x${Buffer.from(s, 'utf-8').toString('hex').padEnd(64, '0')}` as `0x${string}`

beforeEach(() => {
  evmReadContract.mockReset()
  evmCall.mockReset()
  queryUrl.mockReset()
  getParsedAccountInfo.mockReset()
})

describe('resolveContract — ERC-20', () => {
  const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

  it('resolves canonical dynamic-string metadata', async () => {
    evmReadContract.mockResolvedValue(6)
    evmCall
      .mockResolvedValueOnce({ data: abiString('USDC') }) // symbol()
      .mockResolvedValueOnce({ data: abiString('USD Coin') }) // name()

    const res = await resolveContract('Ethereum', USDC)
    expect(res).toEqual({
      chain: 'Ethereum',
      contractAddress: USDC,
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
      tokenStandard: 'erc20',
    })
  })

  it('decodes legacy bytes32 symbol/name (MKR class)', async () => {
    evmReadContract.mockResolvedValue(18)
    evmCall
      .mockResolvedValueOnce({ data: bytes32String('MKR') })
      .mockResolvedValueOnce({ data: bytes32String('Maker') })

    const res = await resolveContract('Ethereum', '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2')
    expect(res.symbol).toBe('MKR')
    expect(res.name).toBe('Maker')
    expect(res.decimals).toBe(18)
  })

  it('lowercases the contract address', async () => {
    evmReadContract.mockResolvedValue(6)
    evmCall.mockResolvedValueOnce({ data: abiString('USDC') }).mockResolvedValueOnce({ data: abiString('USD Coin') })
    const res = await resolveContract('Ethereum', USDC.toUpperCase().replace('0X', '0x'))
    expect(res.contractAddress).toBe(USDC)
  })

  it('fails closed on a malformed 0x address (no RPC fired)', async () => {
    await expect(resolveContract('Ethereum', '0x1234')).rejects.toThrow(/invalid contractAddress/i)
    expect(evmReadContract).not.toHaveBeenCalled()
  })

  it('fails closed when decimals is out of range — never fabricates', async () => {
    evmReadContract.mockResolvedValue(255)
    evmCall.mockResolvedValueOnce({ data: abiString('BAD') }).mockResolvedValueOnce({ data: abiString('Bad') })
    await expect(resolveContract('Ethereum', USDC)).rejects.toThrow(/valid ERC-20 decimals/i)
  })

  it('fails closed when symbol call reverts (empty data)', async () => {
    evmReadContract.mockResolvedValue(6)
    evmCall.mockResolvedValueOnce({ data: undefined }).mockResolvedValueOnce({ data: undefined })
    await expect(resolveContract('Ethereum', USDC)).rejects.toThrow(/valid ERC-20 symbol/i)
  })
})

describe('resolveContract — CW20', () => {
  const TERRA = 'terra15juucad3k2npsj53crl6qhra9f65s9jkas9nzpqypj38en4ht32qczde4a'

  it('resolves CW20 token_info via smart query', async () => {
    queryUrl.mockResolvedValue({
      data: { name: 'Nahmii', symbol: 'NHERA', decimals: 18, total_supply: '1000' },
    })
    const res = await resolveContract('TerraClassic', TERRA)
    expect(res).toEqual({
      chain: 'TerraClassic',
      contractAddress: TERRA,
      symbol: 'NHERA',
      decimals: 18,
      name: 'Nahmii',
      tokenStandard: 'cw20',
      totalSupply: '1000',
    })
  })

  it('fails closed on a non-bech32 address (no query fired)', async () => {
    await expect(resolveContract('Osmosis', '0xdeadbeef')).rejects.toThrow(/invalid contractAddress/i)
    expect(queryUrl).not.toHaveBeenCalled()
  })

  it('fails closed when token_info is missing required fields', async () => {
    queryUrl.mockResolvedValue({ data: { name: 'X' } })
    await expect(resolveContract('TerraClassic', TERRA)).rejects.toThrow(/valid CW20 token_info/i)
  })
})

describe('resolveContract — SPL', () => {
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

  it('resolves an SPL mint (decimals only, no fabricated symbol)', async () => {
    getParsedAccountInfo.mockResolvedValue({
      value: { data: { parsed: { type: 'mint', info: { decimals: 6, supply: '42' } } } },
    })
    const res = await resolveContract('Solana', USDC_MINT)
    expect(res).toEqual({
      chain: 'Solana',
      contractAddress: USDC_MINT,
      decimals: 6,
      tokenStandard: 'spl',
      totalSupply: '42',
    })
    expect(res).not.toHaveProperty('symbol')
  })

  it('fails closed when the account is not a mint', async () => {
    getParsedAccountInfo.mockResolvedValue({
      value: { data: { parsed: { type: 'account', info: {} } } },
    })
    await expect(resolveContract('Solana', USDC_MINT)).rejects.toThrow(/not a mint/i)
  })

  it('fails closed on a non-base58 / wrong-length mint (no RPC fired)', async () => {
    await expect(resolveContract('Solana', '0xnotbase58!!')).rejects.toThrow(/invalid contractAddress/i)
    expect(getParsedAccountInfo).not.toHaveBeenCalled()
  })
})

describe('resolveContract — unsupported chain', () => {
  it('rejects an unsupported chain', async () => {
    // @ts-expect-error — intentionally passing an unsupported chain
    await expect(resolveContract('Bitcoin', 'whatever')).rejects.toThrow(/unsupported chain/i)
  })
})
