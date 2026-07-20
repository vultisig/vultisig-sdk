/**
 * QBTC bank.MsgSend SignDoc golden vector.
 *
 * QBTC signs with post-quantum MLDSA keys, so it CANNOT go through WalletCore
 * (secp256k1-only) - packages/core hand-rolls the Cosmos SignDoc via its own
 * varint/length-prefix helpers (QBTCTx.ts / QBTCHelper.ts). That hand-rolled
 * encoder had no independent byte-level cross-check.
 *
 * Strategy (same as cosmos-send-golden-vectors.test.ts): independently re-encode
 * the ENTIRE signable envelope (MsgSend Any -> TxBody -> AuthInfo -> SignDoc)
 * using cosmjs-types' own protobufjs-generated `.encode()` functions - the
 * canonical cosmos-sdk wire reference - and assert its sha256 equals the shared
 * fixture's `expectedSignDocSha256Hex`. packages/core's compileTx.golden.test.ts
 * asserts its hand-rolled encoder against the SAME fixture value, so the two
 * encoders are bound: neither can drift without a test firing.
 *
 * The only QBTC-specific wire detail vs a vanilla Cosmos send is the signer
 * public-key Any typeUrl (`/cosmos.crypto.mldsa.PubKey`). The MLDSA PubKey proto
 * is `{ key: bytes }` at field 1 - byte-identical to secp256k1 PubKey - so the
 * reference reuses cosmjs-types' PubKey encoder for the inner bytes and only
 * swaps the Any typeUrl.
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { Buffer } from 'buffer'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { PubKey } from 'cosmjs-types/cosmos/crypto/secp256k1/keys'
import { AuthInfo, Fee, ModeInfo, SignDoc, SignerInfo, TxBody } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

type QbtcCrossEncoderFixture = {
  senderAddress: string
  recipientAddress: string
  pubKeyHex: string
  chainId: string
  denom: string
  amount: string
  memo: string
  accountNumber: number
  sequence: number
  feeAmount: string
  gasLimit: number
  expectedSignDocSha256Hex: string
  expectedSerialized: string
}

const loadFixture = (): QbtcCrossEncoderFixture =>
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../../../../testdata/cross-encoder-golden/qbtc-msgsend.json'), 'utf8')
  ) as QbtcCrossEncoderFixture

const bytesToHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

/** Builds the QBTC SignDoc bytes entirely via cosmjs-types (independent of packages/core). */
const buildReferenceSignDoc = (fx: QbtcCrossEncoderFixture): Uint8Array => {
  const msgSendBytes = MsgSend.encode(
    MsgSend.fromPartial({
      fromAddress: fx.senderAddress,
      toAddress: fx.recipientAddress,
      amount: [{ denom: fx.denom, amount: fx.amount }],
    })
  ).finish()

  const anyBytes = Any.encode(
    Any.fromPartial({ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: msgSendBytes })
  ).finish()

  const txBodyBytes = TxBody.encode(
    TxBody.fromPartial({ messages: [Any.decode(anyBytes)], memo: fx.memo })
  ).finish()

  const pubKeyAnyBytes = Any.encode(
    Any.fromPartial({
      typeUrl: '/cosmos.crypto.mldsa.PubKey',
      value: PubKey.encode(PubKey.fromPartial({ key: Uint8Array.from(Buffer.from(fx.pubKeyHex, 'hex')) })).finish(),
    })
  ).finish()

  const authInfoBytes = AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [
        SignerInfo.fromPartial({
          publicKey: Any.decode(pubKeyAnyBytes),
          modeInfo: ModeInfo.fromPartial({ single: { mode: 1 } }),
          sequence: BigInt(fx.sequence),
        }),
      ],
      fee: Fee.fromPartial({
        amount: [{ denom: fx.denom, amount: fx.feeAmount }],
        gasLimit: BigInt(fx.gasLimit),
      }),
    })
  ).finish()

  return SignDoc.encode(
    SignDoc.fromPartial({
      bodyBytes: txBodyBytes,
      authInfoBytes,
      chainId: fx.chainId,
      accountNumber: BigInt(fx.accountNumber),
    })
  ).finish()
}

describe('qbtc / MLDSA bank.MsgSend SignDoc golden vector', () => {
  // CROSS-ENCODER BINDING: reads testdata/cross-encoder-golden/qbtc-msgsend.json - the
  // SAME file packages/core/mpc/tx/compile/compileTx.golden.test.ts reads to assert its
  // hand-rolled MLDSA encoder. Both assert against the fixture's expectedSignDocSha256Hex,
  // so editing the fixture updates BOTH suites at once.
  it('produces the SAME SignDoc sha256 as packages/core hand-rolled MLDSA encoder', () => {
    const fx = loadFixture()
    const signDocBytes = buildReferenceSignDoc(fx)

    expect(bytesToHex(sha256(signDocBytes))).toBe(fx.expectedSignDocSha256Hex)
  })

  it('round-trips fromAddress/toAddress/amount and the MLDSA pubkey typeUrl through decode', () => {
    const fx = loadFixture()
    const signDocBytes = buildReferenceSignDoc(fx)
    const signDoc = SignDoc.decode(signDocBytes)

    expect(signDoc.chainId).toBe(fx.chainId)
    expect(signDoc.accountNumber).toBe(BigInt(fx.accountNumber))

    const txBody = TxBody.decode(signDoc.bodyBytes)
    expect(txBody.memo).toBe(fx.memo)
    expect(txBody.messages[0].typeUrl).toBe('/cosmos.bank.v1beta1.MsgSend')
    const msg = MsgSend.decode(txBody.messages[0].value)
    expect(msg.fromAddress).toBe(fx.senderAddress)
    expect(msg.toAddress).toBe(fx.recipientAddress)
    expect(msg.amount).toEqual([{ denom: fx.denom, amount: fx.amount }])

    const authInfo = AuthInfo.decode(signDoc.authInfoBytes)
    expect(authInfo.signerInfos[0].publicKey?.typeUrl).toBe('/cosmos.crypto.mldsa.PubKey')
    expect(authInfo.fee?.amount).toEqual([{ denom: fx.denom, amount: fx.feeAmount }])
    expect(authInfo.fee?.gasLimit).toBe(BigInt(fx.gasLimit))
  })
})
