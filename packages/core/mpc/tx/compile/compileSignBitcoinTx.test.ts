/**
 * Golden / cross-library check for PSBT-style SignBitcoin compilation.
 *
 * Source of truth for the serialized signed tx:
 * - bitcoinjs-lib `Psbt` finalize + `extractTransaction()` (same stack as
 *   `sighash.test.ts` beside `computePreSigningHashes`).
 * - Sighash: BIP-143 / `hashForWitnessV0` cross-checked in that test file.
 *
 * Signature bytes: secp256k1 ECDSA over the sighash using the standard test
 * private key `0x00…01` (compressed pubkey
 * `0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`),
 * implemented with `tiny-secp256k1` (compact `r||s`) then converted to DER
 * via `encodeDERSignature` — the same DER shape `compileSignBitcoinTx`
 * expects from MPC (`KeysignSignature.der_signature`).
 */
import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { describe, expect, it, beforeAll } from 'vitest'
import { Psbt, payments, networks } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import { TW, initWasm, type WalletCore } from '@trustwallet/wallet-core'

import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'

import { encodeDERSignature } from '../../derSignature'
import { computePreSigningHashes } from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { CoinSchema } from '../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { getPreSigningHashes } from '../preSigningHashes'
import { compileTx } from './compileTx'
import { compileSignBitcoinTx } from './compileSignBitcoinTx'

const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const RECIPIENT_ADDRESS = 'bc1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg'
const EXPECTED_BITCOINJS_RAW_TX =
  '02000000000101aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000ffffffff01905f0100000000001600147dd65592d0ab2fe0d0257d571abf032cd9db93dc02483045022100cf5ed8951fc872ce1ec2021f76de2d191494c78f9ace2901c0ba41e9292bdd5d022018801adb6683ff7d68d0ccd02ecb001169f5f22c3ae0c2b3748bdad457fa649801210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179800000000'

describe('compileSignBitcoinTx', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('matches bitcoinjs-lib finalized P2WPKH tx (DER sig from compact ECDSA)', async () => {
    const privKey = new Uint8Array(32)
    privKey[31] = 1

    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbt.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 90000n,
    })

    const signBitcoin = buildSignBitcoinFromPsbt({
      psbt,
      senderAddress: p2wpkh.address!,
    })
    const [hash] = computePreSigningHashes(signBitcoin)
    const hashHex = Buffer.from(hash).toString('hex')

    const compact = ecc.sign(hash, privKey)
    const der = encodeDERSignature(compact.subarray(0, 32), compact.subarray(32, 64))
    const derHex = Buffer.from(der).toString('hex')

    const twPublicKey = walletCore.PublicKey.createWithData(
      new Uint8Array(TEST_PUBKEY),
      getTwPublicKeyType({ walletCore, chain: Chain.Bitcoin })
    )

    const compiled = compileSignBitcoinTx(
      signBitcoin,
      {
        [hashHex]: {
          msg: '',
          r: '',
          s: '',
          der_signature: derHex,
        },
      },
      twPublicKey
    )

    const decoded = TW.Bitcoin.Proto.SigningOutput.decode(compiled)
    const compiledRaw = Buffer.from(decoded.encoded)

    const psbtRef = new Psbt({ network: networks.bitcoin })
    psbtRef.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbtRef.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 90000n,
    })
    await psbtRef.signInputAsync(0, {
      publicKey: Buffer.from(TEST_PUBKEY),
      sign: h => Buffer.from(ecc.sign(Uint8Array.from(h), privKey)),
    })
    psbtRef.finalizeAllInputs()
    const expected = psbtRef.extractTransaction().toBuffer()

    expect(compiledRaw.toString('hex')).toBe(EXPECTED_BITCOINJS_RAW_TX)
    expect(compiledRaw.equals(expected)).toBe(true)
  })

  it('routes SwapKit PSBT payloads through the SignBitcoin hash and compile path', () => {
    const privKey = new Uint8Array(32)
    privKey[31] = 1

    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbt.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 90000n,
    })

    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Bitcoin,
        ticker: 'BTC',
        address: p2wpkh.address!,
        decimals: 8,
      }),
      toAddress: RECIPIENT_ADDRESS,
      toAmount: '90000',
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          txType: 'PSBT',
          txPayload: psbt.toBuffer(),
        }),
      },
    })

    const [hash] = getPreSigningHashes({
      walletCore,
      chain: Chain.Bitcoin,
      txInputData: new Uint8Array(),
      keysignPayload,
    })
    const hashHex = Buffer.from(hash).toString('hex')
    const compact = ecc.sign(hash, privKey)
    const der = encodeDERSignature(compact.subarray(0, 32), compact.subarray(32, 64))

    const twPublicKey = walletCore.PublicKey.createWithData(
      new Uint8Array(TEST_PUBKEY),
      getTwPublicKeyType({ walletCore, chain: Chain.Bitcoin })
    )

    const compiled = compileTx({
      publicKey: twPublicKey,
      txInputData: new Uint8Array(),
      signatures: {
        [hashHex]: {
          msg: '',
          r: '',
          s: '',
          der_signature: Buffer.from(der).toString('hex'),
        },
      },
      chain: Chain.Bitcoin,
      walletCore,
      keysignPayload,
    })

    const decoded = TW.Bitcoin.Proto.SigningOutput.decode(compiled)

    expect(Buffer.from(decoded.encoded).toString('hex')).toBe(EXPECTED_BITCOINJS_RAW_TX)
  })

  it('returns SwapKit PSBT hashes in deterministic sorted ceremony order', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 1,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 200000n },
    })
    psbt.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 250000n,
    })

    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Bitcoin,
        ticker: 'BTC',
        address: p2wpkh.address!,
        decimals: 8,
      }),
      toAddress: RECIPIENT_ADDRESS,
      toAmount: '250000',
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          txType: 'PSBT',
          txPayload: psbt.toBuffer(),
        }),
      },
    })

    const hashes = getPreSigningHashes({
      walletCore,
      chain: Chain.Bitcoin,
      txInputData: new Uint8Array(),
      keysignPayload,
    }).map(hash => Buffer.from(hash).toString('hex'))

    expect(hashes).toHaveLength(2)
    expect(hashes).toEqual([...hashes].sort())
  })

  it('rejects SwapKit PSBT payloads without a quoted amount', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'aa'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
    })
    psbt.addOutput({
      address: RECIPIENT_ADDRESS,
      value: 90000n,
    })

    const keysignPayload = create(KeysignPayloadSchema, {
      coin: create(CoinSchema, {
        chain: Chain.Bitcoin,
        ticker: 'BTC',
        address: p2wpkh.address!,
        decimals: 8,
      }),
      toAddress: RECIPIENT_ADDRESS,
      toAmount: '',
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          txType: 'PSBT',
          txPayload: psbt.toBuffer(),
        }),
      },
    })

    expect(() =>
      getPreSigningHashes({
        walletCore,
        chain: Chain.Bitcoin,
        txInputData: new Uint8Array(),
        keysignPayload,
      })
    ).toThrow('expected amount is invalid')
  })
})
