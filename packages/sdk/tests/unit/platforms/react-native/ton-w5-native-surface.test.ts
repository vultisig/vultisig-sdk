/**
 * React Native derives addresses through `NativeWalletCore`, whose surface is
 * the subset the native bridge implements — it has `TONAddressConverter` and
 * no `TONWallet`. W5 derivation must therefore never reach for
 * `TONWallet.buildV5R1StateInit`; it builds the StateInit from the key bytes
 * with `@ton/core`. This drives the real `NativeWalletCore` class over a fake
 * native module that offers exactly what the bridge offers.
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it, vi } from 'vitest'

const publicKeyHex = 'aa'.repeat(32)
const v4r2Address = 'UQCf6aQfV3vc8KLtPI_lROY64hUeR1oyNfdbwXB-gwDaKZmi'
const w5Address = 'UQCvaZohosTA0ak9ZFMs-cvL1JrXqogqJH8sI2uO6k8clJpn'

const native = vi.hoisted(() => ({
  publicKeyCreateWithData: vi.fn((_dataBase64: string, _type: number) => 7),
  publicKeyData: vi.fn((_handle: number) => Buffer.from('aa'.repeat(32), 'hex').toString('base64')),
  deriveAddressFromPublicKey: vi.fn(
    (_coinType: number, _handle: number) => 'UQCf6aQfV3vc8KLtPI_lROY64hUeR1oyNfdbwXB-gwDaKZmi'
  ),
}))

vi.mock('expo-modules-core', () => ({
  requireNativeModule: () => native,
}))

import { NativeWalletCore } from '@vultisig/walletcore-native'

import { deriveAddress } from '../../../../src/platforms/react-native/chainHelpers'

describe('TON W5 on the React Native WalletCore surface', () => {
  const walletCore = NativeWalletCore.getInstance()
  const publicKey = walletCore.PublicKey.createWithData(
    Buffer.from(publicKeyHex, 'hex'),
    walletCore.PublicKeyType.ed25519
  )

  it('offers no TONWallet — the surface W5 must not depend on', () => {
    expect('TONWallet' in walletCore).toBe(false)
  })

  it('derives the W5 address from the key bytes without a native W5 builder', () => {
    expect(deriveAddress({ chain: Chain.Ton, publicKey, walletCore, tonWalletVersion: 'v5r1' })).toBe(w5Address)
    expect(native.publicKeyData).toHaveBeenCalledWith(7)
  })

  it('still derives V4R2 through the native bridge', () => {
    expect(deriveAddress({ chain: Chain.Ton, publicKey, walletCore, tonWalletVersion: 'v4r2' })).toBe(v4r2Address)
    expect(native.deriveAddressFromPublicKey).toHaveBeenCalledWith(walletCore.CoinType.ton, 7)
  })
})
