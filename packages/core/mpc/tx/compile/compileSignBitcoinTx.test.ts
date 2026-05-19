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
import { describe, expect, it, beforeAll } from 'vitest'
import { Psbt, payments, networks } from 'bitcoinjs-lib'
import * as ecc from 'tiny-secp256k1'
import { TW, initWasm, type WalletCore } from '@trustwallet/wallet-core'

import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'

import { encodeDERSignature } from '../../derSignature'
import { computePreSigningHashes } from '../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { compileSignBitcoinTx } from './compileSignBitcoinTx'

const TEST_PUBKEY = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const EXPECTED_BITCOINJS_RAW_TX =
  '02000000000101aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0000000000ffffffff01905f010000000000160014751e76e8199196d454941c45d1b3a323f1433bd60247304402204f69fe236b040aa999563dd909273ee088df86e6e1c0c46a083399384c02fc12022038870510658d27312b253380b3b2bbfb1b5db4423399561a3e5737e1540f825b01210279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179800000000'

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
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
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
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
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
})
