import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { tonAddressToRaw } from '@vultisig/core-chain/chains/ton/address'
import { OwnerJettonWallets } from '@vultisig/core-chain/chains/ton/api'
import { makeTonVerifiedJettonRegistry } from '@vultisig/core-chain/chains/ton/jetton/verifiedRegistry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getOwnerJettonWalletsMock = vi.hoisted(() => vi.fn())
const getTonVerifiedJettonRegistryMock = vi.hoisted(() => vi.fn())

vi.mock('@vultisig/core-chain/chains/ton/api', () => ({
  getOwnerJettonWallets: (...args: unknown[]) => getOwnerJettonWalletsMock(...args),
}))

vi.mock('@vultisig/core-chain/chains/ton/jetton/verifiedRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/chains/ton/jetton/verifiedRegistry')>()),
  getTonVerifiedJettonRegistry: () => getTonVerifiedJettonRegistryMock(),
}))

import { findTonCoins } from './ton'

const ADDRESS = 'UQBpY9MNLFOnwqL2A8dqMuefpgrcUDED2t2uWWPaHNibyThr'
const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'
const USDT_RAW = tonAddressToRaw(USDT)
const STAKED = 'EQCqC6EhRJ_tpWngKxL6dV0k6DSnRUrs9GSVkLbfdCqsj6TE'
const STAKED_RAW = tonAddressToRaw(STAKED)
const FAKE_USDT_RAW = '0:' + 'ab'.repeat(32)
const MEME_RAW = '0:' + 'cd'.repeat(32)

const registry = makeTonVerifiedJettonRegistry([
  { address: USDT_RAW, symbol: 'USDT', decimals: 6, logo: 'usdt', priceProviderId: 'tether' },
  { address: STAKED_RAW, symbol: 'STAKED', name: 'Staked TON', logo: 'https://list.example/staked.png' },
])

const walletsResponse = (overrides: Partial<OwnerJettonWallets> = {}): OwnerJettonWallets => ({
  wallets: [
    { jettonMasterAddress: USDT_RAW, balance: 14539900n },
    { jettonMasterAddress: STAKED_RAW, balance: 5n * 10n ** 9n },
    { jettonMasterAddress: FAKE_USDT_RAW, balance: 1000n * 10n ** 6n },
    { jettonMasterAddress: MEME_RAW, balance: 1n },
  ],
  masters: {
    [USDT_RAW]: { address: USDT_RAW, symbol: 'USD₮', name: 'Tether USD', decimals: 6, logo: 'https://tc/usdt.png' },
    [STAKED_RAW]: {
      address: STAKED_RAW,
      symbol: 'STAKED',
      name: 'Staked TON',
      decimals: 9,
      logo: 'https://tc/staked.png',
      isFlaggedScam: false,
    },
    [FAKE_USDT_RAW]: { address: FAKE_USDT_RAW, symbol: 'USD₮', name: 'Tether USD', decimals: 6 },
    [MEME_RAW]: { address: MEME_RAW, symbol: 'MEME', name: 'Meme', decimals: 9 },
  },
  userFriendlyAddresses: {
    [USDT_RAW]: USDT,
    // Toncenter may spell a master non-bounceable; ids must still come out as EQ….
    [STAKED_RAW]: 'UQCqC6EhRJ_tpWngKxL6dV0k6DSnRUrs9GSVkLbfdCqsj_kB',
  },
  ...overrides,
})

describe('findTonCoins', () => {
  beforeEach(() => {
    getOwnerJettonWalletsMock.mockReset()
    getTonVerifiedJettonRegistryMock.mockReset().mockResolvedValue(registry)
  })

  it('returns verified jettons only, dropping counterfeits and unlisted holdings', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue(walletsResponse())

    const coins = await findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })

    expect(getOwnerJettonWalletsMock).toHaveBeenCalledWith(ADDRESS)
    expect(coins.map(coin => coin.id)).toEqual([USDT, STAKED])
  })

  it('uses curated metadata for jettons we ship ourselves', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue(walletsResponse())

    const [usdt] = await findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })

    expect(usdt).toEqual({
      chain: Chain.Ton,
      id: USDT,
      address: ADDRESS,
      ticker: 'USDT',
      decimals: 6,
      logo: 'usdt',
      priceProviderId: 'tether',
    })
  })

  it('builds whitelist-only jettons from Toncenter metadata, filling gaps from the whitelist', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue(walletsResponse())

    const [, staked] = await findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })

    expect(staked).toEqual({
      chain: Chain.Ton,
      id: STAKED,
      address: ADDRESS,
      ticker: 'STAKED',
      decimals: 9,
      logo: 'https://tc/staked.png',
    })
  })

  it('falls back to whitelist metadata and a derived id when Toncenter has neither', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue(
      walletsResponse({
        wallets: [{ jettonMasterAddress: STAKED_RAW, balance: 1n }],
        masters: {},
        userFriendlyAddresses: {},
      })
    )

    const coins = await findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })

    expect(coins).toEqual([
      {
        chain: Chain.Ton,
        id: STAKED,
        address: ADDRESS,
        ticker: 'STAKED',
        decimals: 9,
        logo: 'https://list.example/staked.png',
      },
    ])
  })

  it('ignores zero balances defensively', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue(
      walletsResponse({ wallets: [{ jettonMasterAddress: USDT_RAW, balance: 0n }] })
    )

    await expect(findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })).resolves.toEqual([])
  })

  it('returns nothing for a wallet without jettons', async () => {
    getOwnerJettonWalletsMock.mockResolvedValue({ wallets: [], masters: {}, userFriendlyAddresses: {} })

    await expect(findTonCoins({ chain: OtherChain.Ton, address: ADDRESS })).resolves.toEqual([])
  })
})
