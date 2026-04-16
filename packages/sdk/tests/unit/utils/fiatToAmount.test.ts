import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/coin/price/getCoinPrices')
vi.mock('@vultisig/core-chain/coin/price/evm/getErc20Prices')
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: {
    Ethereum: { ticker: 'ETH', decimals: 18, priceProviderId: 'ethereum' },
    Bitcoin: { ticker: 'BTC', decimals: 8, priceProviderId: 'bitcoin' },
    Solana: { ticker: 'SOL', decimals: 9, priceProviderId: 'solana' },
    Polygon: {
      ticker: 'MATIC',
      decimals: 18,
      priceProviderId: 'polygon-ecosystem-token',
    },
    Bittensor: { ticker: 'TAO', decimals: 9, priceProviderId: 'bittensor' },
  },
}))

import { fiatToAmount, FiatToAmountError } from '../../../src/utils/fiatToAmount'

describe('fiatToAmount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts USD to native token amount using market price', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 2000 })

    // $100 / $2000 per ETH = 0.05 ETH
    const result = await fiatToAmount({
      fiatValue: 100,
      chain: Chain.Ethereum,
      decimals: 18,
    })

    expect(result).toBe('0.05')
  })

  it('defaults fiatCurrency to "usd" and calls price helper with it', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ bitcoin: 50000 })

    await fiatToAmount({
      fiatValue: 1000,
      chain: Chain.Bitcoin,
      decimals: 8,
    })

    expect(getCoinPrices).toHaveBeenCalledWith(expect.objectContaining({ fiatCurrency: 'usd' }))
  })

  it('honors explicit fiatCurrency override (lowercased)', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ bitcoin: 45000 })

    await fiatToAmount({
      fiatValue: 500,
      chain: Chain.Bitcoin,
      decimals: 8,
      fiatCurrency: 'EUR',
    })

    expect(getCoinPrices).toHaveBeenCalledWith(expect.objectContaining({ fiatCurrency: 'eur' }))
  })

  it('handles fiat value as numeric string', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ solana: 100 })

    // $250 / $100 per SOL = 2.5 SOL
    const result = await fiatToAmount({
      fiatValue: '250',
      chain: Chain.Solana,
      decimals: 9,
    })

    expect(result).toBe('2.5')
  })

  it('uses ERC-20 price helper when tokenId is provided on EVM chain', async () => {
    const { getErc20Prices } = await import('@vultisig/core-chain/coin/price/evm/getErc20Prices')
    const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    vi.mocked(getErc20Prices).mockResolvedValue({
      [usdcAddress.toLowerCase()]: 1,
    })

    // $10 / $1 USDC = 10 USDC
    const result = await fiatToAmount({
      fiatValue: 10,
      chain: Chain.Ethereum,
      tokenId: usdcAddress,
      decimals: 6,
    })

    expect(getErc20Prices).toHaveBeenCalledWith(
      expect.objectContaining({
        ids: [usdcAddress],
        chain: Chain.Ethereum,
        fiatCurrency: 'usd',
      })
    )
    expect(result).toBe('10')
  })

  it('rounds result to the token decimal precision', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 3 })

    // $1 / $3 per ETH = 0.333333... repeating — truncate to 18 decimals
    const result = await fiatToAmount({
      fiatValue: 1,
      chain: Chain.Ethereum,
      decimals: 18,
    })

    // Must be a valid decimal string with at most `decimals` fraction digits
    expect(result).toMatch(/^0\.\d{1,18}$/)
    // And must be within tolerance of the true value
    expect(Math.abs(parseFloat(result) - 1 / 3)).toBeLessThan(1e-10)
  })

  it('throws a typed error with LLM-readable message when price lookup returns zero', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 0 })

    await expect(fiatToAmount({ fiatValue: 100, chain: Chain.Ethereum, decimals: 18 })).rejects.toThrow(/price/i)
  })

  it('throws a typed error with LLM-readable message when price lookup fails', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    vi.mocked(getCoinPrices).mockRejectedValue(new Error('network error'))

    await expect(fiatToAmount({ fiatValue: 100, chain: Chain.Ethereum, decimals: 18 })).rejects.toThrow(/price/i)
  })

  it('throws on invalid (non-positive) fiatValue', async () => {
    await expect(fiatToAmount({ fiatValue: 0, chain: Chain.Ethereum, decimals: 18 })).rejects.toThrow(/fiat value/i)

    await expect(fiatToAmount({ fiatValue: -10, chain: Chain.Ethereum, decimals: 18 })).rejects.toThrow(/fiat value/i)

    await expect(fiatToAmount({ fiatValue: 'abc', chain: Chain.Ethereum, decimals: 18 })).rejects.toThrow(/fiat value/i)
  })

  it('throws when ERC-20 price lookup is requested on a non-EVM chain', async () => {
    await expect(
      fiatToAmount({
        fiatValue: 10,
        chain: Chain.Solana,
        tokenId: 'some-mint',
        decimals: 6,
      })
    ).rejects.toThrow(/EVM/i)
  })

  it('expands scientific-notation results into plain decimal strings', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    // $1 / $1e10 per ETH = 1e-10 — JS Number.toString() would emit "1e-10"
    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 1e10 })

    const result = await fiatToAmount({
      fiatValue: 1,
      chain: Chain.Ethereum,
      decimals: 18,
    })

    expect(result).not.toMatch(/e/i)
    expect(result).toMatch(/^0\.\d{1,18}$/)
    expect(parseFloat(result)).toBeCloseTo(1e-10, 20)
  })

  it('returns whole-number results without a trailing dot or zeros', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    // $100 / $10 per ETH = 10
    vi.mocked(getCoinPrices).mockResolvedValue({ ethereum: 10 })

    const result = await fiatToAmount({
      fiatValue: 100,
      chain: Chain.Ethereum,
      decimals: 18,
    })

    expect(result).toBe('10')
  })

  it('throws FiatToAmountError listing known currencies when given an unsupported currency', async () => {
    const err = await fiatToAmount({
      fiatValue: 100,
      chain: Chain.Ethereum,
      decimals: 18,
      fiatCurrency: 'xyz',
    }).catch(e => e)

    expect(err).toBeInstanceOf(FiatToAmountError)
    // Message should mention at least one known currency so an LLM can self-correct
    expect(err.message).toMatch(/usd/i)
    expect(err.message).toMatch(/xyz/i)
  })

  it('returns integer string when decimals is 0', async () => {
    const { getCoinPrices } = await import('@vultisig/core-chain/coin/price/getCoinPrices')
    // $100 / $3 per TAO ≈ 33.333 — decimals: 0 truncates to integer
    vi.mocked(getCoinPrices).mockResolvedValue({ bittensor: 3 })

    const result = await fiatToAmount({
      fiatValue: 100,
      chain: Chain.Bittensor,
      decimals: 0,
    })

    expect(result).toBe('33')
    expect(result).not.toContain('.')
  })
})
