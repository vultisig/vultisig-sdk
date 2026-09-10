import { beforeEach, describe, expect, it, vi } from 'vitest'

const getJupiterVerifiedTokensMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/coin/jupiter/api', () => ({
  getJupiterVerifiedTokens: () => getJupiterVerifiedTokensMock(),
}))

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JLUSDC = '9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D'
const BLANK = 'B1ank111111111111111111111111111111111111111'

const jupiterVerified = [
  { id: USDC, symbol: 'USDC', name: 'USD Coin', decimals: 6, icon: 'https://jup/usdc.png', isVerified: true },
  {
    id: JLUSDC,
    symbol: 'jlUSDC',
    name: 'Jupiter Lend USDC',
    decimals: 6,
    icon: 'https://jup/jlusdc.png',
    isVerified: true,
  },
  { id: BLANK, symbol: '   ', name: 'No symbol', decimals: 9, isVerified: true },
]

const loadModule = async () => {
  vi.resetModules()
  return import('./verifiedRegistry')
}

describe('makeSolanaVerifiedTokenRegistry', () => {
  it('keys mints exactly and indexes symbols and names as normalized skeletons', async () => {
    const { makeSolanaVerifiedTokenRegistry } = await loadModule()

    const registry = makeSolanaVerifiedTokenRegistry([{ address: USDC, symbol: 'USDC', name: 'USD Coin' }])

    expect(Object.keys(registry.byAddress)).toEqual([USDC])
    // Base58 is case-sensitive: a differently-cased string is a different mint.
    expect(registry.byAddress[USDC.toLowerCase()]).toBeUndefined()
    expect(registry.symbols.has('USDC')).toBe(true)
    expect(registry.names.has('USDCOIN')).toBe(true)
  })

  it('keeps the first entry for a mint so curated metadata wins over the Jupiter list', async () => {
    const { makeSolanaVerifiedTokenRegistry } = await loadModule()

    const registry = makeSolanaVerifiedTokenRegistry([
      { address: USDC, symbol: 'USDC', logo: 'usdc' },
      { address: USDC, symbol: 'USDC', name: 'USD Coin', logo: 'https://jup/usdc.png' },
    ])

    expect(registry.byAddress[USDC]).toEqual({ address: USDC, symbol: 'USDC', logo: 'usdc' })
  })

  it('still indexes the symbol and name of a same-mint duplicate, since both describe the verified token', async () => {
    const { makeSolanaVerifiedTokenRegistry } = await loadModule()
    const { resolveSolanaTokenVerification } = await import('./verification')

    const registry = makeSolanaVerifiedTokenRegistry([
      { address: USDC, symbol: 'USDC' },
      { address: USDC, symbol: 'USDC', name: 'USD Coin' },
    ])

    expect(registry.names.has('USDCOIN')).toBe(true)
    // A counterfeit that copies only the Jupiter name spelling is still caught.
    expect(resolveSolanaTokenVerification({ address: BLANK, symbol: 'DOLLAR', name: 'USD Coin', registry })).toBe(
      'scam'
    )
  })
})

describe('getSolanaVerifiedTokenRegistry', () => {
  beforeEach(() => {
    getJupiterVerifiedTokensMock.mockReset()
  })

  it('merges the curated Solana tokens with the Jupiter verified list', async () => {
    getJupiterVerifiedTokensMock.mockResolvedValue(jupiterVerified)
    const { getSolanaVerifiedTokenRegistry } = await loadModule()

    const registry = await getSolanaVerifiedTokenRegistry()

    // Curated USDC keeps its bundled logo even though Jupiter carries a URL.
    expect(registry.byAddress[USDC]).toEqual({ address: USDC, symbol: 'USDC', decimals: 6, logo: 'usdc' })
    expect(registry.byAddress[JLUSDC]).toEqual({
      address: JLUSDC,
      symbol: 'jlUSDC',
      name: 'Jupiter Lend USDC',
      decimals: 6,
      logo: 'https://jup/jlusdc.png',
    })
    expect(registry.names.has('USDCOIN')).toBe(true)
    expect(registry.byAddress[BLANK]).toBeUndefined()
  })

  it('caches a successful fetch', async () => {
    getJupiterVerifiedTokensMock.mockResolvedValue(jupiterVerified)
    const { getSolanaVerifiedTokenRegistry } = await loadModule()

    await getSolanaVerifiedTokenRegistry()
    await getSolanaVerifiedTokenRegistry()

    expect(getJupiterVerifiedTokensMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the curated list when Jupiter is unavailable, and retries next time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getJupiterVerifiedTokensMock.mockRejectedValueOnce(new Error('offline'))
    const { getSolanaVerifiedTokenRegistry } = await loadModule()

    const degraded = await getSolanaVerifiedTokenRegistry()

    expect(degraded.byAddress[USDC]).toMatchObject({ symbol: 'USDC' })
    expect(degraded.byAddress[JLUSDC]).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)

    getJupiterVerifiedTokensMock.mockResolvedValueOnce(jupiterVerified)
    const recovered = await getSolanaVerifiedTokenRegistry()

    expect(recovered.byAddress[JLUSDC]).toBeDefined()
    expect(getJupiterVerifiedTokensMock).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
