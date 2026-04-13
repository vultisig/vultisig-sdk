import { describe, expect, it } from 'vitest'
import {
  Transaction,
  Psbt,
  payments,
  networks,
  script as bscript,
} from 'bitcoinjs-lib'
import { create } from '@bufbuild/protobuf'
import {
  BitcoinInputSchema,
  BitcoinOutputSchema,
  SignBitcoinSchema,
} from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { computePreSigningHashes } from './sighash'

/**
 * Cross-validates our BIP-143 sighash implementation against bitcoinjs-lib v7's
 * hashForWitnessV0, which is a battle-tested reference implementation.
 * See https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
 */

const TEST_PUBKEY = Buffer.from(
  '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  'hex'
)

/** Get bitcoinjs-lib's sighash for comparison. */
const getBjsSighash = (
  psbt: Psbt,
  inputIndex: number,
  value: bigint,
  scriptPubKey: Uint8Array
) => {
  const tx = (psbt as any).__CACHE.__TX as Transaction
  const spkBuf = Buffer.from(scriptPubKey)
  const witnessScript = bscript.compile([
    0x76,
    0xa9,
    spkBuf.subarray(2, 22),
    0x88,
    0xac,
  ])
  return Buffer.from(
    tx.hashForWitnessV0(inputIndex, witnessScript, value, Transaction.SIGHASH_ALL)
  )
}

describe('computePreSigningHashes', () => {
  it('matches bitcoinjs-lib for P2WPKH single-input', () => {
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

    const signBitcoin = buildSignBitcoinFromPsbt({ psbt, senderAddress: p2wpkh.address! })
    const [ourHash] = computePreSigningHashes(signBitcoin)
    const bjsHash = getBjsSighash(psbt, 0, 100000n, p2wpkh.output!)

    expect(Buffer.from(ourHash).toString('hex')).toBe(bjsHash.toString('hex'))
  })

  it('matches bitcoinjs-lib for P2SH-P2WPKH', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const p2sh = payments.p2sh({ redeem: p2wpkh, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'dd'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2sh.output!), value: 200000n },
      redeemScript: Buffer.from(p2sh.redeem!.output!),
    })
    psbt.addOutput({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      value: 190000n,
    })

    const signBitcoin = buildSignBitcoinFromPsbt({ psbt, senderAddress: p2sh.address! })

    // For P2SH-P2WPKH, bitcoinjs-lib uses the redeemScript to derive the witness script
    const tx = (psbt as any).__CACHE.__TX as Transaction
    const witnessScript = bscript.compile([
      0x76, 0xa9,
      p2sh.redeem!.output!.subarray(2, 22),
      0x88, 0xac,
    ])
    const bjsHash = Buffer.from(
      tx.hashForWitnessV0(0, witnessScript, 200000n, Transaction.SIGHASH_ALL)
    )

    const [ourHash] = computePreSigningHashes(signBitcoin)
    expect(Buffer.from(ourHash).toString('hex')).toBe(bjsHash.toString('hex'))
  })

  it('matches bitcoinjs-lib for multi-input with mixed isOurs', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })

    // Input 0: not ours
    psbt.addInput({
      hash: 'bb'.repeat(32),
      index: 0,
      witnessUtxo: {
        script: Buffer.from('0014' + '11'.repeat(20), 'hex'),
        value: 50000n,
      },
    })
    // Input 1: ours
    psbt.addInput({
      hash: 'cc'.repeat(32),
      index: 1,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 75000n },
    })

    psbt.addOutput({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      value: 120000n,
    })

    const signBitcoin = buildSignBitcoinFromPsbt({ psbt, senderAddress: p2wpkh.address! })
    // Override isOurs: input 0 = false, input 1 = true
    signBitcoin.inputs[0].isOurs = false
    signBitcoin.inputs[1].isOurs = true

    const hashes = computePreSigningHashes(signBitcoin)
    expect(hashes).toHaveLength(1) // only one isOurs input

    const bjsHash = getBjsSighash(psbt, 1, 75000n, p2wpkh.output!)
    expect(Buffer.from(hashes[0]).toString('hex')).toBe(bjsHash.toString('hex'))
  })

  it('handles OP_RETURN outputs correctly', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'ee'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 50000n },
    })
    psbt.addOutput({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      value: 40000n,
    })
    // OP_RETURN output
    const opReturnScript = bscript.compile([0x6a, Buffer.from('hello world')])
    psbt.addOutput({ script: opReturnScript, value: 0n })

    const signBitcoin = buildSignBitcoinFromPsbt({ psbt, senderAddress: p2wpkh.address! })
    const [ourHash] = computePreSigningHashes(signBitcoin)
    const bjsHash = getBjsSighash(psbt, 0, 50000n, p2wpkh.output!)

    expect(Buffer.from(ourHash).toString('hex')).toBe(bjsHash.toString('hex'))
  })

  it('preserves explicit sequence=0', () => {
    const p2wpkh = payments.p2wpkh({ pubkey: TEST_PUBKEY, network: networks.bitcoin })
    const psbt = new Psbt({ network: networks.bitcoin })
    psbt.addInput({
      hash: 'ff'.repeat(32),
      index: 0,
      witnessUtxo: { script: Buffer.from(p2wpkh.output!), value: 100000n },
      sequence: 0,
    })
    psbt.addOutput({
      address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      value: 90000n,
    })

    const signBitcoin = buildSignBitcoinFromPsbt({ psbt, senderAddress: p2wpkh.address! })
    expect(signBitcoin.inputs[0].sequence).toBe(0) // not defaulted to 0xffffffff

    const [ourHash] = computePreSigningHashes(signBitcoin)
    const bjsHash = getBjsSighash(psbt, 0, 100000n, p2wpkh.output!)
    expect(Buffer.from(ourHash).toString('hex')).toBe(bjsHash.toString('hex'))
  })

  it('throws for unsupported script types', () => {
    const signBitcoin = create(SignBitcoinSchema, {
      version: 2,
      locktime: 0,
      inputs: [
        create(BitcoinInputSchema, {
          hash: 'aa'.repeat(32),
          index: 0,
          amount: 100000n,
          scriptPubKey: '5120' + 'bb'.repeat(32), // P2TR
          scriptType: 'p2tr',
          isOurs: true,
        }),
      ],
      outputs: [
        create(BitcoinOutputSchema, {
          amount: 90000n,
          scriptPubKey: '0014' + 'cc'.repeat(20),
        }),
      ],
    })

    expect(() => computePreSigningHashes(signBitcoin)).toThrow(
      'Unsupported script type for BIP-143 sighash: p2tr'
    )
  })

  it('throws for non-SIGHASH_ALL', () => {
    const signBitcoin = create(SignBitcoinSchema, {
      version: 2,
      locktime: 0,
      inputs: [
        create(BitcoinInputSchema, {
          hash: 'aa'.repeat(32),
          index: 0,
          amount: 100000n,
          scriptPubKey: '0014' + 'bb'.repeat(20),
          scriptType: 'p2wpkh',
          sighashType: 0x83, // SIGHASH_SINGLE | ANYONECANPAY
          isOurs: true,
        }),
      ],
      outputs: [
        create(BitcoinOutputSchema, {
          amount: 90000n,
          scriptPubKey: '0014' + 'cc'.repeat(20),
        }),
      ],
    })

    expect(() => computePreSigningHashes(signBitcoin)).toThrow(
      'Unsupported sighash type: 0x83'
    )
  })

  it('throws when no signable inputs', () => {
    const signBitcoin = create(SignBitcoinSchema, {
      version: 2,
      locktime: 0,
      inputs: [
        create(BitcoinInputSchema, {
          hash: 'aa'.repeat(32),
          index: 0,
          amount: 100000n,
          scriptPubKey: '0014' + 'bb'.repeat(20),
          scriptType: 'p2wpkh',
          isOurs: false,
        }),
      ],
      outputs: [
        create(BitcoinOutputSchema, {
          amount: 90000n,
          scriptPubKey: '0014' + 'cc'.repeat(20),
        }),
      ],
    })

    expect(() => computePreSigningHashes(signBitcoin)).toThrow(
      'No signable inputs'
    )
  })

  it('throws when no inputs', () => {
    const signBitcoin = create(SignBitcoinSchema, {
      version: 2,
      locktime: 0,
      inputs: [],
      outputs: [],
    })

    expect(() => computePreSigningHashes(signBitcoin)).toThrow(
      'SignBitcoin has no inputs'
    )
  })

  it('throws for P2SH-P2WPKH without redeemScript', () => {
    const signBitcoin = create(SignBitcoinSchema, {
      version: 2,
      locktime: 0,
      inputs: [
        create(BitcoinInputSchema, {
          hash: 'aa'.repeat(32),
          index: 0,
          amount: 100000n,
          scriptPubKey: 'a914' + 'bb'.repeat(20) + '87',
          scriptType: 'p2sh-p2wpkh',
          isOurs: true,
          // no redeemScript
        }),
      ],
      outputs: [
        create(BitcoinOutputSchema, {
          amount: 90000n,
          scriptPubKey: '0014' + 'cc'.repeat(20),
        }),
      ],
    })

    expect(() => computePreSigningHashes(signBitcoin)).toThrow(
      'P2SH-P2WPKH inputs require redeemScript'
    )
  })
})
