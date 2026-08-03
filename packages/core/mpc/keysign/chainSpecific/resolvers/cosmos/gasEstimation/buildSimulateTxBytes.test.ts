/**
 * Real-WalletCore coverage for buildSimulateTxBytes — the highest-risk piece of
 * the initiator path. A WalletCore compile / parser regression here would
 * silently disable dynamic gas fleet-wide (the estimator fails closed), so this
 * exercises the actual tx-byte assembly instead of mocking it.
 */
import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildSimulateTxBytes } from './buildSimulateTxBytes.js'

describe('buildSimulateTxBytes (real WalletCore)', () => {
  let walletCore: WalletCore
  let sender: string
  let recipient: string
  let publicKeyHex: string

  beforeAll(async () => {
    walletCore = await initWasm()

    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const recipientPrivateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2))
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const recipientPublicKey = recipientPrivateKey.getPublicKeySecp256k1(true)

    sender = walletCore.AnyAddress.createWithPublicKey(publicKey, walletCore.CoinType.cosmos).description()
    recipient = walletCore.AnyAddress.createWithPublicKey(recipientPublicKey, walletCore.CoinType.cosmos).description()
    publicKeyHex = Buffer.from(publicKey.data()).toString('hex')
  })

  const build = (overrides: Partial<Parameters<typeof buildSimulateTxBytes>[0]> = {}) =>
    buildSimulateTxBytes({
      walletCore,
      chain: Chain.Cosmos,
      hexPublicKey: publicKeyHex,
      fromAddress: sender,
      toAddress: recipient,
      amount: '12345',
      denom: 'uatom',
      accountNumber: 7n,
      sequence: 3n,
      ...overrides,
    })

  it('assembles a decodable protobuf TxRaw carrying the MsgSend and dummy signature', () => {
    const txBytes = build({ memo: 'simulate' })

    expect(txBytes).toBeTruthy()

    // Valid base64 decoding into a well-formed cosmos TxRaw (body + authInfo +
    // exactly one signature — the 64-byte dummy the simulate endpoint accepts).
    const raw = new Uint8Array(Buffer.from(txBytes, 'base64'))
    expect(raw.length).toBeGreaterThan(0)

    const txRaw = TxRaw.decode(raw)
    expect(txRaw.bodyBytes.length).toBeGreaterThan(0)
    expect(txRaw.authInfoBytes.length).toBeGreaterThan(0)
    expect(txRaw.signatures).toHaveLength(1)
    expect(txRaw.signatures[0]).toHaveLength(64)
  })

  it('produces identical bytes for identical inputs (deterministic)', () => {
    expect(build()).toEqual(build())
  })

  it('grows the tx when a memo is added (memo is charged for gas)', () => {
    const withoutMemo = Buffer.from(build(), 'base64').length
    const withMemo = Buffer.from(build({ memo: 'a much longer memo string' }), 'base64').length

    expect(withMemo).toBeGreaterThan(withoutMemo)
  })

  it('throws on an invalid hex public key (estimator catches this and falls back)', () => {
    expect(() => build({ hexPublicKey: 'not-hex' })).toThrow()
  })
})
