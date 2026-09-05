import { beforeEach, describe, expect, it, vi } from 'vitest'

const getJettonMastersMetadataMock = vi.hoisted(() => vi.fn())
const getTonVerifiedJettonRegistryMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getJettonMastersMetadata: (...args: unknown[]) => getJettonMastersMetadataMock(...args),
}))

vi.mock('./verifiedRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('./verifiedRegistry')>()),
  getTonVerifiedJettonRegistry: () => getTonVerifiedJettonRegistryMock(),
}))

import { getTonJettonVerification, resolveTonJettonVerification } from './verification'
import { makeTonVerifiedJettonRegistry } from './verifiedRegistry'

const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const USDT_RAW = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe'
const NOT_RAW = '0:2f9561' + '0'.repeat(58)
const FAKE_RAW = '0:' + 'ab'.repeat(32)

const registry = makeTonVerifiedJettonRegistry([
  { address: USDT_RAW, symbol: 'USDT', name: 'Tether USD' },
  { address: NOT_RAW, symbol: 'NOT', name: 'Notcoin' },
])

describe('resolveTonJettonVerification', () => {
  it('trusts a listed address whatever it calls itself, in any spelling', () => {
    expect(resolveTonJettonVerification({ address: USDT, symbol: 'Whatever', registry })).toBe('verified')
    expect(resolveTonJettonVerification({ address: USDT_RAW.toUpperCase(), registry })).toBe('verified')
    expect(resolveTonJettonVerification({ address: USDT, isFlaggedScam: true, registry })).toBe('verified')
  })

  it('flags an unlisted jetton that borrows a verified symbol, including homoglyph spellings', () => {
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'USDT', registry })).toBe('scam')
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'USD₮', registry })).toBe('scam')
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'UЅDT', registry })).toBe('scam')
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: '$USĐ₮', registry })).toBe('scam')
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'not', registry })).toBe('scam')
  })

  it('flags an unlisted jetton that borrows a verified name even with a novel symbol', () => {
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'TUSD', name: 'Tether USD', registry })).toBe(
      'scam'
    )
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'Notcoin', registry })).toBe('scam')
  })

  it("honours the indexer's scam flag for unlisted jettons", () => {
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'MEME', isFlaggedScam: true, registry })).toBe(
      'scam'
    )
  })

  it('leaves an unlisted jetton with its own identity unverified', () => {
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: 'MEME', name: 'Meme Coin', registry })).toBe(
      'unverified'
    )
    expect(resolveTonJettonVerification({ address: FAKE_RAW, registry })).toBe('unverified')
    expect(resolveTonJettonVerification({ address: FAKE_RAW, symbol: '💎', registry })).toBe('unverified')
  })
})

describe('getTonJettonVerification', () => {
  beforeEach(() => {
    getJettonMastersMetadataMock.mockReset()
    getTonVerifiedJettonRegistryMock.mockReset().mockResolvedValue(registry)
  })

  it("judges by the master's on-chain symbol and name rather than the locally stored ticker", async () => {
    getJettonMastersMetadataMock.mockResolvedValue({
      [FAKE_RAW]: { address: FAKE_RAW, symbol: 'USD₮', name: 'Tether USD' },
    })

    await expect(getTonJettonVerification({ id: FAKE_RAW, ticker: 'MYCOIN' })).resolves.toBe('scam')
    expect(getJettonMastersMetadataMock).toHaveBeenCalledWith([FAKE_RAW])
  })

  it('falls back to the local ticker when Toncenter cannot be reached', async () => {
    getJettonMastersMetadataMock.mockRejectedValue(new Error('timeout'))

    await expect(getTonJettonVerification({ id: FAKE_RAW, ticker: 'USDT' })).resolves.toBe('scam')
    await expect(getTonJettonVerification({ id: FAKE_RAW, ticker: 'MEME' })).resolves.toBe('unverified')
  })

  it('reports a listed jetton as verified without needing metadata', async () => {
    getJettonMastersMetadataMock.mockResolvedValue({})

    await expect(getTonJettonVerification({ id: USDT })).resolves.toBe('verified')
  })
})
