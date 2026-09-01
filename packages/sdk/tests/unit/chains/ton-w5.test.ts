/**
 * TON wallet V5R1 (W5) — the RN-safe builders against real WalletCore.
 *
 * W5 is a different contract from V4R2 with a different request layout
 * (`signed_external`, signature appended) and a different address for the
 * same key. Every claim below is checked against what WalletCore actually
 * produces, not against our own reconstruction: the pre-image hash through
 * `getPreSigningHashes`, and — stronger — the complete signed external
 * message, by signing the pre-image with a throwaway key on both sides and
 * comparing the broadcast BOCs byte for byte.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Cell } from '@ton/core'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { tonV5R1WalletId } from '@vultisig/core-chain/chains/ton/wallet'
import { getPreSigningHashes } from '@vultisig/core-mpc/tx/preSigningHashes'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildTonJettonTransferTx,
  buildTonSendTx,
  buildTonTxFromSigningPayload,
  deriveTonAddress,
  type TonWalletCoreBackedTxBuilderResult,
} from '../../../src/chains/ton/tx'
import { buildV4R2Wallet } from '../../../src/chains/ton/walletV4R2'
import { buildV5R1Wallet, TON_V5R1_WALLET_ID } from '../../../src/chains/ton/walletV5R1'
import { prepareJettonTransferTxFromKeys } from '../../../src/tools/prep/jettonTransfer'

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

let walletCore: WalletCore

beforeAll(async () => {
  walletCore = await initWasm()
})

type NativeFixture = {
  walletVersion: 'v5r1'
  publicKeyEd25519Hex: string
  senderAddress: string
  recipientAddress: string
  amountNanotons: string
  bounceable: boolean
  sequenceNumber: number
  expireAt: number
  workchain: number
  walletId: number
  expectedSigningHashHex: string
  expectedSigningHashHexSeqno0: string
}

type JettonFixture = Omit<NativeFixture, 'amountNanotons' | 'expectedSigningHashHexSeqno0'> & {
  jettonWalletAddress: string
  amountMinimalUnits: string
  memo: string
  isActiveDestination: boolean
}

const loadFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(resolve(__dirname, '../../../../../testdata/cross-encoder-golden', name), 'utf8')) as T

const native = loadFixture<NativeFixture>('ton-w5-native-transfer.json')
const jetton = loadFixture<JettonFixture>('ton-w5-jetton-transfer.json')

/** A throwaway signing key. Only its public half ever reaches a fixture. */
const throwawayPrivateKeyHex = '11'.repeat(32)

const expectWalletCoreParity = (result: TonWalletCoreBackedTxBuilderResult) => {
  const hashes = getPreSigningHashes({ walletCore, chain: Chain.Ton, txInputData: result.walletCoreTxInputData })
  expect(hashes).toHaveLength(1)
  expect(bytesToHex(hashes[0]!)).toBe(result.signingHashHex)
}

/**
 * Sign the builder's pre-image with the throwaway key, finalize, and compare
 * the broadcast message to the one WalletCore emits when it signs the very
 * same input with the same key. This pins envelope, StateInit, request layout
 * and signature placement, not just the hash.
 *
 * The comparison is on the external message *cell*: a BOC is one of several
 * valid serializations of a cell tree, and once a StateInit (a wide code tree)
 * rides along, `@ton/core` and WalletCore order its subtrees differently while
 * agreeing on every cell. Without a StateInit the tree is a chain and the bytes
 * must match too.
 */
const expectByteIdenticalSignedMessage = (result: TonWalletCoreBackedTxBuilderResult) => {
  const privateKey = walletCore.PrivateKey.createWithData(Buffer.from(throwawayPrivateKeyHex, 'hex'))
  const signature = privateKey.sign(Buffer.from(result.signingHashHex, 'hex'), walletCore.Curve.ed25519)
  const ours = result.finalize(bytesToHex(signature)).signedBocBase64

  const input = TW.TheOpenNetwork.Proto.SigningInput.decode(result.walletCoreTxInputData)
  input.privateKey = privateKey.data()
  input.publicKey = new Uint8Array()
  const theirs = TW.TheOpenNetwork.Proto.SigningOutput.decode(
    walletCore.AnySigner.sign(TW.TheOpenNetwork.Proto.SigningInput.encode(input).finish(), walletCore.CoinType.ton)
  )
  expect(theirs.error).toBe(0)

  const [ourCell] = Cell.fromBoc(Buffer.from(ours, 'base64'))
  const [theirCell] = Cell.fromBoc(Buffer.from(theirs.encoded, 'base64'))
  expect(ourCell!.hash().toString('hex')).toBe(theirCell!.hash().toString('hex'))
  if (input.sequenceNumber !== 0) {
    expect(ours).toBe(theirs.encoded)
  }
}

const throwawayPublicKeyHex = () =>
  bytesToHex(
    walletCore.PrivateKey.createWithData(Buffer.from(throwawayPrivateKeyHex, 'hex')).getPublicKeyEd25519().data()
  )

describe('W5 wallet view', () => {
  it('uses the published W5R1 code and the mainnet wallet id WalletCore hardcodes', () => {
    const wallet = buildV5R1Wallet({ publicKeyEd25519: Buffer.from(native.publicKeyEd25519Hex, 'hex') })
    const stateInit = walletCore.TONWallet.buildV5R1StateInit(
      walletCore.PublicKey.createWithData(
        Buffer.from(native.publicKeyEd25519Hex, 'hex'),
        walletCore.PublicKeyType.ed25519
      ),
      0,
      TON_V5R1_WALLET_ID
    )
    const [theirs] = Cell.fromBoc(Buffer.from(stateInit, 'base64'))

    const code = shouldBePresent(wallet.init.code, 'W5 code cell')
    const data = shouldBePresent(wallet.init.data, 'W5 data cell')

    expect(TON_V5R1_WALLET_ID).toBe(tonV5R1WalletId)
    expect(code.hash().toString('hex')).toBe('20834b7b72b112147e1b2fb457b84e74d1a30f04f737d4f62a668e9552d2b72f')
    expect(code.hash().toString('hex')).toBe(theirs!.refs[0]!.hash().toString('hex'))
    expect(data.hash().toString('hex')).toBe(theirs!.refs[1]!.hash().toString('hex'))
    expect(wallet.addressString({ bounceable: false })).toBe(native.senderAddress)
  })

  it('derives the W5 address on request and V4R2 by default — two accounts, one key', () => {
    const v4r2 = deriveTonAddress(native.publicKeyEd25519Hex)
    const w5 = deriveTonAddress(native.publicKeyEd25519Hex, { walletVersion: 'v5r1' })

    expect(w5).toBe(native.senderAddress)
    expect(v4r2).toBe(
      buildV4R2Wallet({ publicKeyEd25519: Buffer.from(native.publicKeyEd25519Hex, 'hex') }).addressString()
    )
    expect(v4r2).not.toBe(w5)
  })
})

describe('W5 native transfer', () => {
  const baseV4 = () => ({
    publicKeyEd25519: native.publicKeyEd25519Hex,
    to: native.recipientAddress,
    amount: BigInt(native.amountNanotons),
    bounceable: native.bounceable,
    seqno: native.sequenceNumber,
    validUntil: native.expireAt,
  })

  const build = (overrides: Partial<Parameters<typeof buildTonSendTx>[0]> = {}) =>
    buildTonSendTx({
      walletVersion: 'v5r1',
      publicKeyEd25519: native.publicKeyEd25519Hex,
      to: native.recipientAddress,
      amount: BigInt(native.amountNanotons),
      bounceable: native.bounceable,
      seqno: native.sequenceNumber,
      validUntil: native.expireAt,
      workchain: native.workchain,
      subWalletId: native.walletId,
      ...overrides,
    })

  it('matches the shared golden vector and real WalletCore', () => {
    const result = build()

    expect(result.fromAddress).toBe(native.senderAddress)
    expect(result.signingHashHex).toBe(native.expectedSigningHashHex)
    expectWalletCoreParity(result)
  })

  it('matches on the first send too, where the StateInit rides along', () => {
    const result = build({ seqno: 0 })

    expect(result.signingHashHex).toBe(native.expectedSigningHashHexSeqno0)
    expectWalletCoreParity(result)
  })

  it('carries a comment identically', () => {
    expectWalletCoreParity(build({ memo: 'vultisig w5' }))
  })

  // The signature goes AFTER the request in W5, before it in V4R2; a builder
  // that got this wrong would still produce the right hash.
  it.each([
    ['a later send', 7],
    ['the deploying first send', 0],
  ])('produces the byte-identical signed message for %s', (_, seqno) => {
    expectByteIdenticalSignedMessage(build({ publicKeyEd25519: throwawayPublicKeyHex(), seqno }))
  })

  it("signs a request for the key's W5 address, not its V4R2 one", () => {
    expect(build().fromAddress).not.toBe(buildTonSendTx(baseV4()).fromAddress)
  })

  it('refuses the V4R2 sub-wallet id on a W5 request — the contract has exactly one id we can prove', () => {
    expect(() => build({ subWalletId: 698983191 })).toThrow(/supports only W5 wallet ID 2147483409/)
  })

  it('leaves V4R2 untouched: no version and an explicit v4r2 are the same bytes', () => {
    const implicit = buildTonSendTx(baseV4())
    const explicit = buildTonSendTx({ ...baseV4(), walletVersion: 'v4r2' })

    expect(implicit.signingHashHex).toBe(explicit.signingHashHex)
    expect(implicit.signingHashHex).not.toBe(build().signingHashHex)
    expectWalletCoreParity(implicit)
  })
})

describe('W5 jetton transfer', () => {
  const build = (overrides: Partial<Parameters<typeof buildTonJettonTransferTx>[0]> = {}) =>
    buildTonJettonTransferTx({
      walletVersion: 'v5r1',
      publicKeyEd25519: jetton.publicKeyEd25519Hex,
      to: jetton.recipientAddress,
      jettonWalletAddress: jetton.jettonWalletAddress,
      amount: BigInt(jetton.amountMinimalUnits),
      isActiveDestination: jetton.isActiveDestination,
      memo: jetton.memo,
      seqno: jetton.sequenceNumber,
      validUntil: jetton.expireAt,
      workchain: jetton.workchain,
      subWalletId: jetton.walletId,
      ...overrides,
    })

  it('matches the shared golden vector and real WalletCore', () => {
    const result = build()

    expect(result.fromAddress).toBe(jetton.senderAddress)
    expect(result.signingHashHex).toBe(jetton.expectedSigningHashHex)
    expectWalletCoreParity(result)
  })

  it('produces the byte-identical signed message', () => {
    expectByteIdenticalSignedMessage(build({ publicKeyEd25519: throwawayPublicKeyHex() }))
  })

  it('is reachable through the vault-free prep helper', () => {
    const viaPrep = prepareJettonTransferTxFromKeys(
      {
        ecdsaPublicKey: '',
        eddsaPublicKey: jetton.publicKeyEd25519Hex,
        hexChainCode: '',
        localPartyId: 'w5-fixture',
        libType: 'DKLS',
      },
      {
        receiver: jetton.recipientAddress,
        jettonWalletAddress: jetton.jettonWalletAddress,
        amount: BigInt(jetton.amountMinimalUnits),
        isActiveDestination: jetton.isActiveDestination,
        memo: jetton.memo,
        seqno: jetton.sequenceNumber,
        validUntil: jetton.expireAt,
        workchain: jetton.workchain,
        walletVersion: 'v5r1',
      }
    )

    expect(viaPrep.signingHashHex).toBe(jetton.expectedSigningHashHex)
  })
})

describe('W5 prebuilt signing payload', () => {
  it('finalizes a W5 payload with the signature appended, exactly as the native builder does', () => {
    const publicKeyEd25519 = throwawayPublicKeyHex()
    const reference = buildTonSendTx({
      walletVersion: 'v5r1',
      publicKeyEd25519,
      to: native.recipientAddress,
      amount: BigInt(native.amountNanotons),
      bounceable: native.bounceable,
      seqno: 0,
      validUntil: native.expireAt,
    })
    const prebuilt = buildTonTxFromSigningPayload({
      walletVersion: 'v5r1',
      publicKeyEd25519,
      signingPayloadBoc: reference.unsignedBocHex,
      includeStateInit: true,
    })
    const signature = bytesToHex(
      walletCore.PrivateKey.createWithData(Buffer.from(throwawayPrivateKeyHex, 'hex')).sign(
        Buffer.from(reference.signingHashHex, 'hex'),
        walletCore.Curve.ed25519
      )
    )

    expect(prebuilt.signingHashHex).toBe(reference.signingHashHex)
    expect(prebuilt.fromAddress).toBe(reference.fromAddress)
    expect(prebuilt.finalize(signature).signedBocBase64).toBe(reference.finalize(signature).signedBocBase64)
    expectByteIdenticalSignedMessage(reference)
  })

  it('addresses the envelope to the W5 wallet, not the V4R2 one, for the same payload', () => {
    const publicKeyEd25519 = native.publicKeyEd25519Hex
    const payload = buildTonSendTx({
      walletVersion: 'v5r1',
      publicKeyEd25519,
      to: native.recipientAddress,
      amount: 1n,
      bounceable: true,
      seqno: 3,
      validUntil: native.expireAt,
    }).unsignedBocHex

    expect(
      buildTonTxFromSigningPayload({ walletVersion: 'v5r1', publicKeyEd25519, signingPayloadBoc: payload }).fromAddress
    ).toBe(native.senderAddress)
    expect(buildTonTxFromSigningPayload({ publicKeyEd25519, signingPayloadBoc: payload }).fromAddress).not.toBe(
      native.senderAddress
    )
  })
})

// WalletCore stamps u32::MAX as the expiry of a wallet's first request (seqno 0)
// for both contracts. The value is in the pre-image, so a builder that kept the
// caller's expiry there would hash differently from every co-signer — and for
// V4R2 it did, until this was pinned.
describe('first-send expiry', () => {
  const build = (walletVersion: 'v4r2' | 'v5r1', seqno: number) =>
    buildTonSendTx({
      walletVersion,
      publicKeyEd25519: throwawayPublicKeyHex(),
      to: native.recipientAddress,
      amount: BigInt(native.amountNanotons),
      bounceable: native.bounceable,
      seqno,
      validUntil: native.expireAt,
    })

  const expiryOf = (unsignedBocHex: string, walletVersion: 'v4r2' | 'v5r1') => {
    const slice = Cell.fromBoc(Buffer.from(unsignedBocHex, 'hex'))[0]!.beginParse()
    // V4R2: subWalletId(32) || validUntil(32); W5: opcode(32) || walletId(32) || validUntil(32)
    slice.skip(walletVersion === 'v5r1' ? 64 : 32)
    return slice.loadUint(32)
  }

  it.each(['v4r2', 'v5r1'] as const)(
    '%s: stamps u32::MAX on seqno 0 and matches WalletCore byte for byte',
    walletVersion => {
      const first = build(walletVersion, 0)
      const later = build(walletVersion, 7)

      expect(expiryOf(first.unsignedBocHex, walletVersion)).toBe(0xffffffff)
      expect(expiryOf(later.unsignedBocHex, walletVersion)).toBe(native.expireAt)
      expectByteIdenticalSignedMessage(first)
      expectByteIdenticalSignedMessage(later)
    }
  )
})
