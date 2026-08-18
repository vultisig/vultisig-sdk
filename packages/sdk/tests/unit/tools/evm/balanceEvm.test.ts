import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetBalance = vi.fn()
const mockReadContract = vi.fn()
const mockCall = vi.fn()

vi.mock('@vultisig/core-chain/chains/evm/client', () => ({
  getEvmClient: () => ({ getBalance: mockGetBalance, readContract: mockReadContract, call: mockCall }),
}))

import { getEvmBalances } from '@/tools/evm/balanceEvm'

const HOLDER = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F' as const
// Real MKR (Maker) contract address: 0x9f8F72aA9304c8B593d555F12eF6589cC3A579A
const MKR = '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A' as const

/** Canonical ABI-encoded dynamic `string` return, as a well-behaved ERC-20's symbol() returns it. */
const encodeAbiString = (s: string): `0x${string}` => encodeAbiParameters(parseAbiParameters('string'), [s])

/**
 * MKR's actual on-chain symbol() return shape: `bytes32 public symbol = "MKR"`,
 * a fixed-size right-padded bytes32 (predates the ERC-20 dynamic-string
 * convention). NOT a canonical ABI-encoded dynamic string.
 */
const MKR_SYMBOL_BYTES32 = `0x${Buffer.from('MKR', 'utf-8').toString('hex').padEnd(64, '0')}` as const

describe('getEvmBalances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns native-only when no tokens are passed', async () => {
    mockGetBalance.mockResolvedValueOnce(1_500_000_000_000_000_000n) // 1.5 ETH

    const result = await getEvmBalances('Ethereum', { address: HOLDER })

    expect(result).toEqual([{ symbol: 'ETH', decimals: 18, raw: 1_500_000_000_000_000_000n, balance: '1.5' }])
    expect(mockGetBalance).toHaveBeenCalledTimes(1)
    expect(mockReadContract).not.toHaveBeenCalled()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('reads native + ERC-20 (balanceOf/decimals/symbol) in one pass', async () => {
    mockGetBalance.mockResolvedValueOnce(0n)
    mockReadContract
      .mockResolvedValueOnce(500_000n) // balanceOf -> 0.5 USDC
      .mockResolvedValueOnce(6) // decimals
    mockCall.mockResolvedValueOnce({ data: encodeAbiString('USDC') }) // symbol

    const result = await getEvmBalances('Ethereum', { address: HOLDER, tokens: [USDC] })

    expect(result).toEqual([
      { symbol: 'ETH', decimals: 18, raw: 0n, balance: '0' },
      { contractAddress: USDC, symbol: 'USDC', decimals: 6, raw: 500_000n, balance: '0.5' },
    ])
    expect(mockReadContract).toHaveBeenCalledTimes(2)
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('formats sub-unit balances without precision loss', async () => {
    mockGetBalance.mockResolvedValueOnce(1n) // 1 wei

    const [native] = await getEvmBalances('Ethereum', { address: HOLDER })

    expect(native.balance).toBe('0.000000000000000001')
    expect(native.raw).toBe(1n)
  })

  it('uses the chain native ticker (BNB on BSC)', async () => {
    mockGetBalance.mockResolvedValueOnce(0n)

    const [native] = await getEvmBalances('BSC', { address: HOLDER })

    expect(native.symbol).toBe('BNB')
    expect(native.decimals).toBe(18)
  })

  it('keeps per-token decimals straight across mixed-decimal ERC-20s', async () => {
    // Adversarial: two tokens with different decimals (6 vs 18) resolved
    // concurrently must each format against their OWN decimals, never the
    // native's nor each other's. Order of the result must match input order.
    mockGetBalance.mockResolvedValueOnce(0n)
    mockReadContract
      .mockResolvedValueOnce(1_500_000n) // USDC balanceOf
      .mockResolvedValueOnce(6) // USDC decimals
      .mockResolvedValueOnce(1_500_000_000_000_000_000n) // DAI balanceOf
      .mockResolvedValueOnce(18) // DAI decimals
    mockCall
      .mockResolvedValueOnce({ data: encodeAbiString('USDC') })
      .mockResolvedValueOnce({ data: encodeAbiString('DAI') })

    const [, usdc, dai] = await getEvmBalances('Ethereum', { address: HOLDER, tokens: [USDC, DAI] })

    // 1.50 USDC with a trailing zero stripped (parity with viem formatUnits).
    expect(usdc).toEqual({ contractAddress: USDC, symbol: 'USDC', decimals: 6, raw: 1_500_000n, balance: '1.5' })
    expect(dai).toEqual({
      contractAddress: DAI,
      symbol: 'DAI',
      decimals: 18,
      raw: 1_500_000_000_000_000_000n,
      balance: '1.5',
    })
  })

  it('decodes bytes32-returning ERC-20 symbols like MKR without failing the batch', async () => {
    // MKR's symbol() returns a right-padded bytes32, not a canonical ABI
    // dynamic string. A strict string decode on this shape must not abort the
    // whole batch read (regression for sdk#1946); MKR resolves correctly and
    // an unrelated token in the same batch is unaffected.
    mockGetBalance.mockResolvedValueOnce(0n)
    mockReadContract
      .mockResolvedValueOnce(2_000_000_000_000_000_000n) // MKR balanceOf -> 2 MKR
      .mockResolvedValueOnce(18) // MKR decimals
      .mockResolvedValueOnce(500_000n) // USDC balanceOf
      .mockResolvedValueOnce(6) // USDC decimals
    mockCall
      .mockResolvedValueOnce({ data: MKR_SYMBOL_BYTES32 }) // MKR symbol (bytes32)
      .mockResolvedValueOnce({ data: encodeAbiString('USDC') }) // USDC symbol (string)

    const result = await getEvmBalances('Ethereum', { address: HOLDER, tokens: [MKR, USDC] })

    expect(result).toEqual([
      { symbol: 'ETH', decimals: 18, raw: 0n, balance: '0' },
      { contractAddress: MKR, symbol: 'MKR', decimals: 18, raw: 2_000_000_000_000_000_000n, balance: '2' },
      { contractAddress: USDC, symbol: 'USDC', decimals: 6, raw: 500_000n, balance: '0.5' },
    ])
  })

  it('propagates RPC failure (fail-closed, never a silent zero balance)', async () => {
    // A non-standard / non-contract address whose decimals() reverts must
    // reject the whole read, not fall back to a fabricated 0 balance.
    mockGetBalance.mockResolvedValueOnce(0n)
    mockReadContract
      .mockResolvedValueOnce(123n) // balanceOf ok
      .mockRejectedValueOnce(new Error('execution reverted')) // decimals reverts
    mockCall.mockResolvedValueOnce({ data: encodeAbiString('???') })

    await expect(getEvmBalances('Ethereum', { address: HOLDER, tokens: [USDC] })).rejects.toThrow('execution reverted')
  })
})
