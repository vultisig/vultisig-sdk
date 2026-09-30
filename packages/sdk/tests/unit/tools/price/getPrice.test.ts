import { Address } from '@ton/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueryUrl = vi.fn()

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (...args: unknown[]) => mockQueryUrl(...args),
}))

vi.mock('@vultisig/core-config', () => ({
  rootApiUrl: 'https://api.vultisig.com',
}))

import {
  getPrice,
  getPricesBatch,
  isKnownNativePriceSymbol,
  NATIVE_COINGECKO_IDS,
  symbolFromCoinGeckoId,
} from '@/tools/price'

const simplePrice = (usd: number, change = 0, mcap = 0) => ({
  usd,
  usd_24h_change: change,
  usd_market_cap: mcap,
})

describe('coinGeckoIds map', () => {
  it('maps native tickers case-insensitively', () => {
    expect(isKnownNativePriceSymbol('eth')).toBe(true)
    expect(isKnownNativePriceSymbol('BTC')).toBe(true)
    expect(isKnownNativePriceSymbol('NOTACOIN')).toBe(false)
    expect(NATIVE_COINGECKO_IDS.ETH).toBe('ethereum')
  })

  it('reverse-resolves colliding ids to the canonical ticker', () => {
    // LUNA/LUNA2 both map to terra-luna-2; LUNA is the canonical winner.
    expect(symbolFromCoinGeckoId('terra-luna-2')).toBe('LUNA')
    // USTC/UST both map to terrausd; USTC is canonical.
    expect(symbolFromCoinGeckoId('terrausd')).toBe('USTC')
    expect(symbolFromCoinGeckoId('ethereum')).toBe('ETH')
    expect(symbolFromCoinGeckoId('not-a-coin')).toBeUndefined()
  })

  it('maps POL/MATIC to the live polygon slug, not the dead matic-network feed', () => {
    // CoinGecko deprecated `matic-network` (now returns an empty body with no
    // `usd` field → every POL/MATIC lookup would throw). The live slug after the
    // MATIC→POL rebrand is `polygon-ecosystem-token`. Pin both tickers to it.
    expect(NATIVE_COINGECKO_IDS.POL).toBe('polygon-ecosystem-token')
    expect(NATIVE_COINGECKO_IDS.MATIC).toBe('polygon-ecosystem-token')
  })

  it('Route 3: prices POL via the live polygon slug', async () => {
    mockQueryUrl.mockResolvedValueOnce({ 'polygon-ecosystem-token': simplePrice(0.42, -1.9, 3.9e9) })

    const quote = await getPrice({ symbol: 'POL' })

    expect(quote.usd).toBe(0.42)
    expect(quote.coingeckoId).toBe('polygon-ecosystem-token')
    expect(mockQueryUrl).toHaveBeenCalledWith(expect.stringContaining('/simple/price?ids=polygon-ecosystem-token'))
  })
})

describe('getPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Route 3: prices a native ticker via the coin-id map', async () => {
    mockQueryUrl.mockResolvedValueOnce({ ethereum: simplePrice(3421.55, 2.5, 4.1e11) })

    const quote = await getPrice({ symbol: 'eth' })

    expect(quote.usd).toBe(3421.55)
    expect(quote.usd24hChange).toBe(2.5)
    expect(quote.usdMarketCap).toBe(4.1e11)
    expect(quote.resolvedSymbol).toBe('ETH')
    expect(quote.coingeckoId).toBe('ethereum')
    // Hit the /simple/price endpoint with the mapped id.
    expect(mockQueryUrl).toHaveBeenCalledWith(expect.stringContaining('/simple/price?ids=ethereum'))
  })

  it('Route 0: prices by explicit coingecko id', async () => {
    mockQueryUrl.mockResolvedValueOnce({ thorchain: simplePrice(4.2) })

    const quote = await getPrice({ coingeckoId: 'thorchain', symbol: 'RUNE' })

    expect(quote.usd).toBe(4.2)
    expect(quote.resolvedSymbol).toBe('RUNE')
    expect(quote.coingeckoId).toBe('thorchain')
  })

  it('Route 1: prices an EVM token by contract + chain', async () => {
    const contract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    // token_price response keyed by lowercase contract
    mockQueryUrl.mockResolvedValueOnce({ [contract.toLowerCase()]: simplePrice(1.0, 0.01, 3.2e10) })
    // contract metadata
    mockQueryUrl.mockResolvedValueOnce({ id: 'usd-coin', symbol: 'usdc', name: 'USD Coin' })

    const quote = await getPrice({ tokenContract: contract, chain: 'Ethereum' })

    expect(quote.usd).toBe(1.0)
    expect(quote.resolvedSymbol).toBe('USDC')
    expect(quote.resolvedName).toBe('USD Coin')
    expect(quote.chain).toBe('Ethereum')
    expect(quote.contractAddress).toBe(contract)
    expect(mockQueryUrl).toHaveBeenCalledWith(
      expect.stringContaining('/simple/token_price/ethereum?contract_addresses=' + contract.toLowerCase())
    )
  })

  it.each([
    ['Avalanche', 'avalanche'],
    ['Zksync', 'zksync'],
    ['Sei', 'sei-v2'],
    ['Robinhood', 'robinhood'],
    ['Hyperliquid', 'hyperliquid'],
  ])('prices %s contracts through the live %s platform', async (chain, platform) => {
    const contract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    mockQueryUrl.mockResolvedValueOnce({ [contract.toLowerCase()]: simplePrice(1) })
    const quote = await getPrice({
      tokenContract: contract,
      chain,
      symbol: 'USDC',
      name: 'USD Coin',
      coingeckoId: 'usd-coin',
    })
    expect(quote.chain).toBe(chain)
    expect(quote.usd).toBe(1)
    expect(mockQueryUrl).toHaveBeenCalledWith(
      expect.stringContaining(`/simple/token_price/${platform}?contract_addresses=${contract.toLowerCase()}`)
    )
  })

  it('prices a TON jetton without lowercasing its identifier', async () => {
    const contract = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
    mockQueryUrl.mockResolvedValueOnce({ [contract]: simplePrice(1) })
    mockQueryUrl.mockResolvedValueOnce({ id: 'tether', symbol: 'usdt', name: 'Tether' })
    const quote = await getPrice({ tokenContract: contract, chain: 'Ton' })
    expect(quote).toMatchObject({
      usd: 1,
      chain: 'Ton',
      contractAddress: contract,
      resolvedSymbol: 'USDT',
      coingeckoId: 'tether',
    })
    expect(mockQueryUrl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`/simple/token_price/the-open-network?contract_addresses=${contract}`)
    )
    expect(mockQueryUrl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/coins/the-open-network/contract/${contract}`)
    )
  })

  it.each(['raw', 'non-bounceable', 'base64'])('matches equivalent TON %s response addresses', async form => {
    const contract = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
    const parsed = Address.parse(contract)
    const key =
      form === 'raw'
        ? parsed.toRawString()
        : parsed.toString({ bounceable: form !== 'non-bounceable', urlSafe: form !== 'base64' })
    mockQueryUrl.mockResolvedValueOnce({ [key]: simplePrice(1) })
    const quote = await getPrice({
      tokenContract: contract,
      chain: 'Ton',
      symbol: 'USDT',
      name: 'Tether',
      coingeckoId: 'tether',
    })
    expect(quote.usd).toBe(1)
    expect(mockQueryUrl).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed raw TON response keys even when their parsed prefix matches', async () => {
    const contract = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
    const key = `${Address.parse(contract).toRawString()}:extra`
    mockQueryUrl.mockResolvedValueOnce({ [key]: simplePrice(99999) })
    await expect(getPrice({ tokenContract: contract, chain: 'Ton' })).rejects.toThrow(/TON token price lookup failed/)
  })

  it('encodes a raw TON contract in price and metadata URLs', async () => {
    const contract = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs').toRawString()
    mockQueryUrl.mockResolvedValueOnce({ [contract]: simplePrice(1) })
    mockQueryUrl.mockResolvedValueOnce({ id: 'tether', symbol: 'usdt', name: 'Tether' })
    await getPrice({ tokenContract: contract, chain: 'Ton' })
    expect(mockQueryUrl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`contract_addresses=${encodeURIComponent(contract)}`)
    )
    expect(mockQueryUrl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(`/contract/${encodeURIComponent(contract)}`)
    )
  })

  it.each([
    'invalid-address',
    `0:${'1'.repeat(64)}:extra`,
    `0garbage:${'1'.repeat(64)}`,
    `0x:${'1'.repeat(64)}`,
    `99999999999999999999999:${'1'.repeat(64)}`,
    'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDA',
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  ])('rejects invalid TON contract %s without falling back to a native ticker', async tokenContract => {
    await expect(getPrice({ tokenContract, chain: 'Ton', symbol: 'TON' })).rejects.toThrow(/invalid TON/)
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })

  it.each(['wrong-account', 'changed-case'])('rejects a TON price for %s', async kind => {
    const contract = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
    const key = kind === 'changed-case' ? contract.toLowerCase() : `0:${'1'.repeat(64)}`
    mockQueryUrl.mockResolvedValueOnce({ [key]: simplePrice(99999) })
    await expect(getPrice({ tokenContract: contract, chain: 'Ton' })).rejects.toThrow(/TON token price lookup failed/)
    expect(mockQueryUrl).toHaveBeenCalledTimes(1)
  })

  it('rejects a case-altered Solana response key', async () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    mockQueryUrl.mockResolvedValueOnce({ [mint.toLowerCase()]: simplePrice(99999) })
    await expect(getPrice({ tokenContract: mint, chain: 'Solana' })).rejects.toThrow(/solana token price lookup failed/)
  })

  it('does not infer an unsupported non-EVM route from the shared map', async () => {
    await expect(
      getPrice({ tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'Cosmos' })
    ).rejects.toThrow(/unsupported chain/)
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })

  it('rejects unsupported address shapes', async () => {
    await expect(getPrice({ tokenContract: 'unsupported', chain: 'Ethereum' })).rejects.toThrow()
    expect(mockQueryUrl).not.toHaveBeenCalled()
  })

  it('Route 1: skips the metadata fetch when symbol+name+id provided', async () => {
    const contract = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    mockQueryUrl.mockResolvedValueOnce({ [contract.toLowerCase()]: simplePrice(1.0) })

    const quote = await getPrice({
      tokenContract: contract,
      chain: 'Ethereum',
      symbol: 'USDC',
      name: 'USD Coin',
      coingeckoId: 'usd-coin',
    })

    expect(quote.usd).toBe(1.0)
    // Only one call: the price lookup, no metadata follow-up.
    expect(mockQueryUrl).toHaveBeenCalledTimes(1)
  })

  it('Route 2: prices a Solana mint', async () => {
    const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    mockQueryUrl.mockResolvedValueOnce({ [mint]: simplePrice(1.0) })
    mockQueryUrl.mockResolvedValueOnce({ id: 'usd-coin', symbol: 'usdc', name: 'USD Coin' })

    const quote = await getPrice({ tokenContract: mint, chain: 'Solana' })

    expect(quote.usd).toBe(1.0)
    expect(quote.chain).toBe('Solana')
    expect(quote.contractAddress).toBe(mint)
    expect(mockQueryUrl).toHaveBeenCalledWith(
      expect.stringContaining('/simple/token_price/solana?contract_addresses=' + mint)
    )
  })

  it('Route 1: rejects a wrong-token response keyed to a different contract', async () => {
    // Caller asks for USDC; upstream/proxy returns a DIFFERENT contract's entry.
    // We must NOT hand back that wrong-token price under the USDC label.
    const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const attacker = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
    mockQueryUrl.mockResolvedValueOnce({ [attacker]: simplePrice(99999) })

    await expect(getPrice({ tokenContract: usdc, chain: 'Ethereum' })).rejects.toThrow(/token price lookup failed/)
  })

  it('Route 1: matches the requested contract case-insensitively (checksum casing)', async () => {
    // CoinGecko keys by lowercase; caller passes checksum-cased. Must still match.
    const checksum = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    mockQueryUrl.mockResolvedValueOnce({ [checksum.toLowerCase()]: simplePrice(1.0) })
    mockQueryUrl.mockResolvedValueOnce({ id: 'usd-coin', symbol: 'usdc', name: 'USD Coin' })

    const quote = await getPrice({ tokenContract: checksum, chain: 'Ethereum' })
    expect(quote.usd).toBe(1.0)
  })

  it('Route 2: rejects a Solana response keyed to a different mint', async () => {
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const otherMint = 'So11111111111111111111111111111111111111112'
    mockQueryUrl.mockResolvedValueOnce({ [otherMint]: simplePrice(160) })

    await expect(getPrice({ tokenContract: usdcMint, chain: 'Solana' })).rejects.toThrow(
      /solana token price lookup failed/
    )
  })

  it('throws on EVM contract with no chain', async () => {
    await expect(getPrice({ tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' })).rejects.toThrow(
      /chain is required/
    )
  })

  it('throws on an unsupported chain for a contract lookup', async () => {
    await expect(
      getPrice({ tokenContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chain: 'Fantom' })
    ).rejects.toThrow(/unsupported chain/)
  })

  it('throws on an unknown native ticker', async () => {
    await expect(getPrice({ symbol: 'NOTACOIN' })).rejects.toThrow(/requires a resolved CoinGecko id/)
  })

  it('throws when no identity is provided', async () => {
    await expect(getPrice({})).rejects.toThrow(/must provide either/)
  })

  it('throws when the upstream returns no usd field', async () => {
    mockQueryUrl.mockResolvedValueOnce({ ethereum: { usd_24h_change: 1 } })
    await expect(getPrice({ symbol: 'ETH' })).rejects.toThrow(/price lookup failed/)
  })
})

describe('getPricesBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a mix of tickers in input order', async () => {
    mockQueryUrl
      .mockResolvedValueOnce({ ethereum: simplePrice(3000) })
      .mockResolvedValueOnce({ bitcoin: simplePrice(60000) })
      .mockResolvedValueOnce({ 'usd-coin': simplePrice(1) })

    const results = await getPricesBatch([{ symbol: 'ETH' }, { symbol: 'BTC' }, { symbol: 'USDC' }])

    expect(results).toHaveLength(3)
    expect(results.every(r => r.ok)).toBe(true)
    expect(results[0].ok && results[0].quote.resolvedSymbol).toBe('ETH')
    expect(results[1].ok && results[1].quote.usd).toBe(60000)
    expect(results[2].ok && results[2].quote.resolvedSymbol).toBe('USDC')
  })

  it('isolates a failing query without sinking the batch', async () => {
    mockQueryUrl.mockResolvedValueOnce({ ethereum: simplePrice(3000) })
    // second query is an unknown ticker → getPrice throws before any fetch

    const results = await getPricesBatch([{ symbol: 'ETH' }, { symbol: 'NOTACOIN' }])

    expect(results[0].ok).toBe(true)
    expect(results[1].ok).toBe(false)
    expect(results[1].ok === false && results[1].error).toMatch(/requires a resolved CoinGecko id/)
  })
})
