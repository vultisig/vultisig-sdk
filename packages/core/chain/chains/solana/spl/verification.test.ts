import { beforeEach, describe, expect, it, vi } from 'vitest'

const getJupiterTokensMock = vi.hoisted(() => vi.fn())
const getSolanaVerifiedTokenRegistryMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/coin/jupiter/api', () => ({
  getJupiterTokens: (...args: unknown[]) => getJupiterTokensMock(...args),
}))

vi.mock('./verifiedRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('./verifiedRegistry')>()),
  getSolanaVerifiedTokenRegistry: () => getSolanaVerifiedTokenRegistryMock(),
}))

import { getSolanaTokenVerification, resolveSolanaTokenVerification } from './verification'
import { makeSolanaVerifiedTokenRegistry } from './verifiedRegistry'

const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const FAKE = 'HBiHPHC6JFCE3cfCrERiFnJUVTzGErhZm9RmsTtzDJUb'
const NEW = 'Newm1nt1111111111111111111111111111111111111'

const registry = makeSolanaVerifiedTokenRegistry([
  { address: USDT, symbol: 'USDT', name: 'Tether USD' },
  { address: JUP, symbol: 'JUP', name: 'Jupiter' },
])

describe('resolveSolanaTokenVerification', () => {
  it('trusts a listed mint whatever it calls itself', () => {
    expect(resolveSolanaTokenVerification({ address: USDT, symbol: 'Whatever', registry })).toBe('verified')
    expect(resolveSolanaTokenVerification({ address: USDT, isVerified: null, registry })).toBe('verified')
  })

  it('matches mints exactly, since base58 is case-sensitive', () => {
    expect(resolveSolanaTokenVerification({ address: USDT.toLowerCase(), symbol: 'USDT', registry })).toBe('scam')
  })

  it("trusts Jupiter's own verified flag for a mint the registry does not list yet", () => {
    expect(resolveSolanaTokenVerification({ address: NEW, symbol: 'USDT', isVerified: true, registry })).toBe(
      'verified'
    )
    expect(resolveSolanaTokenVerification({ address: NEW, symbol: 'NEW', isVerified: false, registry })).toBe(
      'unverified'
    )
  })

  it('flags an unlisted mint that borrows a verified symbol, including homoglyph spellings', () => {
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'USDT', registry })).toBe('scam')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'USD₮', registry })).toBe('scam')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'UЅDT', registry })).toBe('scam')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: '$USĐ₮', registry })).toBe('scam')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'jup', registry })).toBe('scam')
  })

  it('flags an unlisted mint that borrows a verified name even with a novel symbol', () => {
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'TUSD', name: 'Tether USD', registry })).toBe('scam')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'Jupiter', registry })).toBe('scam')
  })

  it('leaves an unlisted mint with its own identity unverified', () => {
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: 'MEME', name: 'Meme Coin', registry })).toBe(
      'unverified'
    )
    expect(resolveSolanaTokenVerification({ address: FAKE, registry })).toBe('unverified')
    expect(resolveSolanaTokenVerification({ address: FAKE, symbol: '💎', registry })).toBe('unverified')
  })
})

describe('getSolanaTokenVerification', () => {
  beforeEach(() => {
    getJupiterTokensMock.mockReset()
    getSolanaVerifiedTokenRegistryMock.mockReset().mockResolvedValue(registry)
  })

  it("judges by the mint's Jupiter symbol and name rather than the locally stored ticker", async () => {
    getJupiterTokensMock.mockResolvedValue({
      [FAKE]: { id: FAKE, symbol: 'USD₮', name: 'Tether USD', decimals: 8, isVerified: null },
    })

    await expect(getSolanaTokenVerification({ id: FAKE, ticker: 'MYCOIN' })).resolves.toBe('scam')
    expect(getJupiterTokensMock).toHaveBeenCalledWith([FAKE])
  })

  it('falls back to the local ticker when Jupiter cannot be reached or does not index the mint', async () => {
    getJupiterTokensMock.mockRejectedValueOnce(new Error('timeout'))
    await expect(getSolanaTokenVerification({ id: FAKE, ticker: 'USDT' })).resolves.toBe('scam')

    getJupiterTokensMock.mockResolvedValueOnce({})
    await expect(getSolanaTokenVerification({ id: FAKE, ticker: 'MEME' })).resolves.toBe('unverified')
  })

  it('reports a listed mint as verified without consulting Jupiter', async () => {
    await expect(getSolanaTokenVerification({ id: USDT })).resolves.toBe('verified')
    expect(getJupiterTokensMock).not.toHaveBeenCalled()
  })

  it('reports a mint Jupiter marks verified as verified even when the registry is stale', async () => {
    getJupiterTokensMock.mockResolvedValue({
      [NEW]: { id: NEW, symbol: 'NEW', name: 'Newly Listed', decimals: 6, isVerified: true },
    })

    await expect(getSolanaTokenVerification({ id: NEW })).resolves.toBe('verified')
  })
})
