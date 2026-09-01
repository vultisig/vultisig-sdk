import { initWasm, WalletCore } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  defaultTonWalletVersion,
  deriveTonAddress,
  resolveTonWalletVersion,
  tonMaxMessagesPerRequest,
  tonV5R1WalletId,
  tonWalletVersions,
} from './wallet'

// Two keys, each with the address WalletCore derives for it under both contracts.
const keyA = {
  hex: 'aa'.repeat(32),
  v4r2: 'UQCf6aQfV3vc8KLtPI_lROY64hUeR1oyNfdbwXB-gwDaKZmi',
  v5r1: 'UQCvaZohosTA0ak9ZFMs-cvL1JrXqogqJH8sI2uO6k8clJpn',
}
const keyB = {
  hex: '6c756400bac0b153b421df6e199302537d12f7d4a53447004485700a958e7571',
  v4r2: 'UQCc9iCgP_b5RMJcFE5XD8zStfjtNHLhDWfUqC5m1SjSer95',
  v5r1: 'UQCiCOKISC3h1l7re_h5NLjH5gLcE4FkJMDMBSnI4FFWtP44',
}
const keys = [keyA, keyB]

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

const publicKeyOf = (hex: string) =>
  walletCore.PublicKey.createWithData(Buffer.from(hex, 'hex'), walletCore.PublicKeyType.ed25519)

describe('deriveTonAddress', () => {
  it.each(keys)('derives a different account for each contract from key $hex', ({ hex, v4r2, v5r1 }) => {
    const publicKey = publicKeyOf(hex)

    expect(deriveTonAddress({ publicKey, walletCore, version: 'v4r2' })).toBe(v4r2)
    expect(deriveTonAddress({ publicKey, walletCore, version: 'v5r1' })).toBe(v5r1)
    expect(v4r2).not.toBe(v5r1)
  })

  // The V4R2 arm is WalletCore's own TON derivation, so existing vault
  // addresses cannot move when a wallet version starts being passed around.
  it('keeps V4R2 identical to what WalletCore derives on its own', () => {
    const publicKey = publicKeyOf(keyA.hex)

    expect(deriveTonAddress({ publicKey, walletCore, version: 'v4r2' })).toBe(
      walletCore.CoinTypeExt.deriveAddressFromPublicKey(walletCore.CoinType.ton, publicKey)
    )
  })

  it('defaults to V4R2, the contract every existing account uses', () => {
    expect(defaultTonWalletVersion).toBe('v4r2')
    expect(tonWalletVersions).toEqual(['v4r2', 'v5r1'])
  })

  it('uses the mainnet W5 wallet id WalletCore hardcodes', () => {
    // -239 (mainnet global id) XOR 0x80000000 (client context, workchain 0,
    // version 0, subwallet 0)
    expect(tonV5R1WalletId).toBe((-239 ^ 0x80000000) >>> 0)
  })
})

describe('resolveTonWalletVersion', () => {
  it.each(keys)('recognises both of the key $hex accounts', ({ hex, v4r2, v5r1 }) => {
    const publicKey = publicKeyOf(hex)

    expect(resolveTonWalletVersion({ address: v4r2, publicKey, walletCore })).toBe('v4r2')
    expect(resolveTonWalletVersion({ address: v5r1, publicKey, walletCore })).toBe('v5r1')
  })

  // The keysign payload may carry the sender in any TON form; the account is
  // the same, so the contract is the same.
  it('matches by account identity, not by string form', () => {
    const publicKey = publicKeyOf(keyA.hex)
    const bounceable = 'EQCvaZohosTA0ak9ZFMs-cvL1JrXqogqJH8sI2uO6k8clMei'
    const raw = '0:af699a21a2c4c0d1a93d64532cf9cbcbd49ad7aa882a247f2c236b8eea4f1c94'

    expect(resolveTonWalletVersion({ address: bounceable, publicKey, walletCore })).toBe('v5r1')
    expect(resolveTonWalletVersion({ address: raw, publicKey, walletCore })).toBe('v5r1')
  })

  it("refuses an address that is not this key's wallet under either contract", () => {
    const publicKey = publicKeyOf(keyA.hex)

    expect(() => resolveTonWalletVersion({ address: keyB.v4r2, publicKey, walletCore })).toThrow(
      /not this key's V4R2 or W5 wallet/
    )
  })
})

describe('tonMaxMessagesPerRequest', () => {
  it('reflects each contract: V4 is limited by its code, W5 by the 255-entry action list', () => {
    expect(tonMaxMessagesPerRequest).toEqual({ v4r2: 4, v5r1: 255 })
  })
})
