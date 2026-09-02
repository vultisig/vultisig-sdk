import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tonAddressToRaw } from './address'

const queryUrlMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: (url: string) => queryUrlMock(url),
}))

import { getJettonMastersMetadata, getOwnerJettonWallets } from './api'

const OWNER = 'UQBpY9MNLFOnwqL2A8dqMuefpgrcUDED2t2uWWPaHNibyThr'
const RAW_OWNER = tonAddressToRaw(OWNER).toUpperCase()
const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const RAW_USDT = tonAddressToRaw(USDT).toUpperCase()

const usdtTokenInfo = {
  valid: true,
  type: 'jetton_masters',
  name: 'Tether USD',
  symbol: 'USD₮',
  image: 'https://tether.to/images/logoCircle.png',
  is_scam: false,
  extra: { decimals: '6', _image_medium: 'https://proxy.toncenter.com/medium.png' },
}

const rawAddress = (index: number) => `0:${index.toString(16).padStart(64, '0').toUpperCase()}`

const walletEntry = (jetton: string, owner = RAW_OWNER) => ({
  address: `0:${'1'.repeat(64)}`,
  owner,
  jetton,
  balance: '42',
})

const readParam = (url: string, name: string) => new URL(url).searchParams.get(name)

describe('getOwnerJettonWallets', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('requests non-zero balances for the owner and parses the embedded master metadata', async () => {
    queryUrlMock.mockResolvedValue({
      jetton_wallets: [walletEntry(RAW_USDT)],
      address_book: { [RAW_USDT]: { user_friendly: USDT } },
      metadata: {
        [RAW_USDT]: { is_indexed: true, token_info: [usdtTokenInfo] },
        [`0:${'1'.repeat(64)}`]: { is_indexed: true, token_info: [{ valid: true, type: 'jetton_wallets' }] },
      },
    })

    const result = await getOwnerJettonWallets(OWNER)

    const url = queryUrlMock.mock.calls[0][0] as string
    expect(readParam(url, 'owner_address')).toBe(tonAddressToRaw(OWNER))
    expect(readParam(url, 'exclude_zero_balance')).toBe('true')
    expect(readParam(url, 'offset')).toBe('0')

    const key = RAW_USDT.toLowerCase()
    expect(result.wallets).toEqual([{ jettonMasterAddress: key, balance: 42n }])
    expect(result.masters[key]).toEqual({
      address: key,
      symbol: 'USD₮',
      name: 'Tether USD',
      decimals: 6,
      logo: 'https://proxy.toncenter.com/medium.png',
      isFlaggedScam: false,
    })
    expect(result.userFriendlyAddresses[key]).toBe(USDT)
  })

  it('drops wallets that belong to someone else when the proxy returns an unfiltered list', async () => {
    queryUrlMock.mockResolvedValue({
      jetton_wallets: [walletEntry(RAW_USDT, `0:${'F'.repeat(64)}`), walletEntry(rawAddress(7))],
      address_book: {},
    })

    const result = await getOwnerJettonWallets(OWNER)

    expect(result.wallets).toEqual([{ jettonMasterAddress: rawAddress(7).toLowerCase(), balance: 42n }])
    expect(result.masters).toEqual({})
  })

  it('pages through the listing until a short page arrives', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => walletEntry(rawAddress(index)))
    const secondPage = [walletEntry(rawAddress(100))]
    queryUrlMock
      .mockResolvedValueOnce({ jetton_wallets: firstPage, address_book: {} })
      .mockResolvedValueOnce({ jetton_wallets: secondPage, address_book: {} })

    const result = await getOwnerJettonWallets(OWNER)

    expect(result.wallets).toHaveLength(101)
    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    expect(readParam(queryUrlMock.mock.calls[1][0] as string, 'offset')).toBe('100')
  })

  it('stops after a bounded number of pages if the proxy ignores the offset', async () => {
    const page = Array.from({ length: 100 }, (_, index) => walletEntry(rawAddress(index)))
    queryUrlMock.mockResolvedValue({ jetton_wallets: page, address_book: {} })

    await getOwnerJettonWallets(OWNER)

    expect(queryUrlMock).toHaveBeenCalledTimes(20)
  })
})

describe('getJettonMastersMetadata', () => {
  beforeEach(() => {
    queryUrlMock.mockReset()
  })

  it('batches addresses, dedupes them and keys the result by lower-cased raw address', async () => {
    queryUrlMock.mockImplementation(async (url: string) => {
      const addresses = (readParam(url, 'address') ?? '').split(',')

      return {
        jetton_masters: addresses.map(address => ({ address, jetton_content: { symbol: `J${address.slice(-2)}` } })),
        metadata: {},
      }
    })

    const addresses = Array.from({ length: 60 }, (_, index) => rawAddress(index))
    const result = await getJettonMastersMetadata([...addresses, USDT, RAW_USDT])

    expect(queryUrlMock).toHaveBeenCalledTimes(2)
    expect(readParam(queryUrlMock.mock.calls[0][0] as string, 'limit')).toBe('50')
    expect(Object.keys(result)).toHaveLength(61)
    expect(result[RAW_USDT.toLowerCase()]).toMatchObject({ symbol: `J${RAW_USDT.toLowerCase().slice(-2)}` })
    expect(result[rawAddress(3).toLowerCase()]?.decimals).toBeUndefined()
  })

  it('prefers the validated indexer entry over on-chain content and surfaces the scam flag', async () => {
    queryUrlMock.mockResolvedValue({
      jetton_masters: [{ address: RAW_USDT, jetton_content: { symbol: 'onchain', decimals: '9' } }],
      metadata: { [RAW_USDT]: { is_indexed: true, token_info: [{ ...usdtTokenInfo, is_scam: true }] } },
    })

    const result = await getJettonMastersMetadata([USDT])

    expect(result[RAW_USDT.toLowerCase()]).toMatchObject({ symbol: 'USD₮', decimals: 6, isFlaggedScam: true })
  })

  it('omits masters Toncenter does not know', async () => {
    queryUrlMock.mockResolvedValue({ jetton_masters: [], metadata: {} })

    await expect(getJettonMastersMetadata([USDT])).resolves.toEqual({})
  })
})
