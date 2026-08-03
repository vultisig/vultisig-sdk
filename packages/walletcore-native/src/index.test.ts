import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  derivationPath: vi.fn((_coinType: number) => "m/44'/60'/0'/0/0"),
  deriveAddressFromPublicKey: vi.fn((_coinType: number, _handle: number) => '0x1234'),
}))

vi.mock('expo-modules-core', () => ({
  requireNativeModule: () => native,
}))

import { type NativePublicKeyInstance, NativeWalletCore } from './index'

describe('NativeWalletCore Robinhood contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the canonical finite coin type to the native derivation bridge', () => {
    const walletCore = NativeWalletCore.getInstance()
    const coinType = walletCore.CoinType.robinhoodChain

    expect(coinType).toBe(10_004_663)
    expect(Number.isInteger(coinType)).toBe(true)
    expect(walletCore.CoinTypeExt.derivationPath(coinType)).toBe("m/44'/60'/0'/0/0")
    expect(native.derivationPath).toHaveBeenCalledWith(10_004_663)
  })

  it('uses the same EVM address derivation contract as Ethereum', () => {
    const walletCore = NativeWalletCore.getInstance()
    const publicKey = { _handle: 7 } as NativePublicKeyInstance

    const ethereumAddress = walletCore.CoinTypeExt.deriveAddressFromPublicKey(walletCore.CoinType.ethereum, publicKey)
    const robinhoodAddress = walletCore.CoinTypeExt.deriveAddressFromPublicKey(
      walletCore.CoinType.robinhoodChain,
      publicKey
    )

    expect(robinhoodAddress).toBe(ethereumAddress)
    expect(native.deriveAddressFromPublicKey).toHaveBeenNthCalledWith(1, 60, 7)
    expect(native.deriveAddressFromPublicKey).toHaveBeenNthCalledWith(2, 10_004_663, 7)
  })
})
