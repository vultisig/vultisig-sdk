import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  anyAddressCreateSS58: vi.fn(() => ({ description: 'ss58-address', data: 'AQID' })),
  anyAddressCreateSS58WithPublicKey: vi.fn(() => ({ description: 'ss58-address', data: 'AQID' })),
  anyAddressData: vi.fn(),
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

describe('NativeWalletCore SS58 constructors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the explicit prefix and preserves description and bytes from one native result', () => {
    const wc = NativeWalletCore.getInstance()
    const address = wc.AnyAddress.createSS58('ss58-address', wc.CoinType.polkadot, 42)
    expect(native.anyAddressCreateSS58).toHaveBeenCalledWith('ss58-address', 354, 42)
    expect(address.description()).toBe('ss58-address')
    expect(address.data()).toEqual(new Uint8Array([1, 2, 3]))
    expect(native.anyAddressData).not.toHaveBeenCalled()
    expect(() => address.delete()).not.toThrow()
  })

  it('forwards the public-key handle and prefix without reparsing with a default prefix', () => {
    const wc = NativeWalletCore.getInstance()
    const publicKey = { _handle: 7 } as NativePublicKeyInstance
    const address = wc.AnyAddress.createSS58WithPublicKey(publicKey, wc.CoinType.polkadot, 42)
    expect(native.anyAddressCreateSS58WithPublicKey).toHaveBeenCalledWith(7, 354, 42)
    expect(address.description()).toBe('ss58-address')
    expect(address.data()).toEqual(new Uint8Array([1, 2, 3]))
    expect(native.anyAddressData).not.toHaveBeenCalled()
  })

  it('propagates invalid-address errors from the native constructor', () => {
    const wc = NativeWalletCore.getInstance()
    native.anyAddressCreateSS58.mockImplementationOnce(() => {
      throw new Error('Invalid SS58 address')
    })
    expect(() => wc.AnyAddress.createSS58('invalid', wc.CoinType.polkadot, 42)).toThrow('Invalid SS58 address')
  })
})
