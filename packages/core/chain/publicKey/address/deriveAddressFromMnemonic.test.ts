import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { beforeAll, describe, expect, it } from 'vitest'

import { deriveAddressFromMnemonic } from './deriveAddressFromMnemonic'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const chainsWithCustomAddressFormat = new Set<Chain>([
  Chain.MayaChain,
  Chain.Bittensor,
  Chain.BitcoinCash,
  Chain.Cardano,
  Chain.QBTC,
])

let walletCore: WalletCore
beforeAll(async () => {
  walletCore = await initWasm()
})

const getWalletCoreAddress = (chain: Chain) => {
  const hdWallet = walletCore.HDWallet.createWithMnemonic(mnemonic, '')
  try {
    return hdWallet.getAddressForCoin(getCoinType({ chain, walletCore }))
  } finally {
    hdWallet.delete()
  }
}

describe('deriveAddressFromMnemonic', () => {
  it('derives a maya address from the THORChain key', () => {
    const address = deriveAddressFromMnemonic({ chain: Chain.MayaChain, mnemonic, walletCore })
    const thorAddress = deriveAddressFromMnemonic({ chain: Chain.THORChain, mnemonic, walletCore })

    expect(address.startsWith('maya1')).toBe(true)
    expect(thorAddress.startsWith('thor1')).toBe(true)

    const maya = walletCore.AnyAddress.createBech32(address, walletCore.CoinType.thorchain, 'maya')
    const thor = walletCore.AnyAddress.createBech32(thorAddress, walletCore.CoinType.thorchain, 'thor')
    try {
      expect(maya.data()).toEqual(thor.data())
    } finally {
      maya.delete()
      thor.delete()
    }
  })

  it('derives a Bittensor address with SS58 prefix 42', () => {
    const address = deriveAddressFromMnemonic({ chain: Chain.Bittensor, mnemonic, walletCore })

    expect(walletCore.AnyAddress.isValidSS58(address, walletCore.CoinType.polkadot, 42)).toBe(true)
    expect(address).not.toBe(getWalletCoreAddress(Chain.Polkadot))
  })

  it('drops the bitcoincash: prefix', () => {
    const address = deriveAddressFromMnemonic({ chain: Chain.BitcoinCash, mnemonic, walletCore })

    expect(`bitcoincash:${address}`).toBe(getWalletCoreAddress(Chain.BitcoinCash))
  })

  it('matches WalletCore for chains without a custom address format', () => {
    for (const chain of Object.values(Chain)) {
      if (chainsWithCustomAddressFormat.has(chain)) continue

      expect(deriveAddressFromMnemonic({ chain, mnemonic, walletCore }), chain).toBe(getWalletCoreAddress(chain))
    }
  })
})
