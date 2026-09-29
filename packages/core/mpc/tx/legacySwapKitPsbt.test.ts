import { Buffer } from 'buffer'
import { createHash } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { p2pkhScriptForAddress } from '@vultisig/core-chain/chains/utxo/tx/p2pkhScriptForAddress'
import { TW } from '@trustwallet/wallet-core'
import { crypto, Psbt, script, Transaction } from 'bitcoinjs-lib'
import bs58check from 'bs58check'
import { describe, expect, it } from 'vitest'

import { computePreSigningHashes } from '../keysign/signingInputs/resolvers/bitcoin/sighash'
import { CoinSchema } from '../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { compileSignBitcoinTx } from './compile/compileSignBitcoinTx'
import {
  assertLegacySwapKitSigningKey,
  getSwapKitSignBitcoin,
  verifySwapKitBitcoinPsbtOutputs,
} from './swapkitSignBitcoin'

const pubkey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const senderHash = Buffer.from(crypto.hash160(pubkey))
const destinationHash = Buffer.alloc(20, 0x22)

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}
const u64 = (value: bigint) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64LE(value)
  return bytes
}
const hash256 = (bytes: Buffer) => {
  const once = createHash('sha256').update(bytes).digest()
  return createHash('sha256').update(once).digest()
}

/** One-input golden oracle assembled from the DOGE and BCH consensus preimages. */
const independentHash = (psbt: Psbt, scriptPubKey: Buffer, amount: bigint, chain: Chain) => {
  const input = psbt.txInputs[0]
  const outputs = Buffer.concat(
    psbt.txOutputs.map(output =>
      Buffer.concat([u64(BigInt(output.value)), Buffer.from([output.script.length]), Buffer.from(output.script)])
    )
  )
  const outpoint = Buffer.concat([Buffer.from(input.hash), u32(input.index)])
  const sequence = u32(input.sequence ?? 0xffffffff)
  const sighash = u32(chain === Chain.BitcoinCash ? 0x41 : 1)
  const preimage =
    chain === Chain.BitcoinCash
      ? Buffer.concat([
          u32(psbt.version),
          hash256(outpoint),
          hash256(sequence),
          outpoint,
          Buffer.from([scriptPubKey.length]),
          scriptPubKey,
          u64(amount),
          sequence,
          hash256(outputs),
          u32(psbt.locktime),
          sighash,
        ])
      : Buffer.concat([
          u32(psbt.version),
          Buffer.from([1]),
          outpoint,
          Buffer.from([scriptPubKey.length]),
          scriptPubKey,
          sequence,
          Buffer.from([psbt.txOutputs.length]),
          outputs,
          u32(psbt.locktime),
          sighash,
        ])
  return hash256(preimage).toString('hex')
}

const address = (chain: Chain, hash: Buffer) =>
  bs58check.encode(Buffer.concat([Buffer.from([chain === Chain.Dogecoin ? 0x1e : 0x00]), hash]))

const makeFixture = (chain: typeof Chain.Dogecoin | typeof Chain.BitcoinCash) => {
  const senderAddress = address(chain, senderHash)
  const targetAddress = address(chain, destinationHash)
  const sourceScript = p2pkhScriptForAddress(chain, senderAddress)
  const destinationScript = p2pkhScriptForAddress(chain, targetAddress)
  const previous = new Transaction()
  previous.addInput(Buffer.alloc(32), 0xffffffff)
  previous.addOutput(sourceScript, 200_000n)

  const psbt = new Psbt()
  psbt.setVersion(2)
  psbt.setLocktime(345)
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    sequence: 0xfffffffe,
    nonWitnessUtxo: previous.toBuffer(),
  })
  psbt.addOutput({ script: destinationScript, value: 90_000n })
  psbt.addOutput({ script: sourceScript, value: 100_000n })
  return { psbt, senderAddress, targetAddress, sourceScript, destinationScript }
}

describe.each([Chain.Dogecoin, Chain.BitcoinCash] as const)('SwapKit %s PSBT', chain => {
  const fixture = makeFixture(chain)

  it('uses the provider transaction for a co-signer and preserves legacy serialization', () => {
    const coin = create(CoinSchema, { chain, address: fixture.senderAddress })
    const payload = create(KeysignPayloadSchema, {
      coin,
      toAddress: fixture.targetAddress,
      toAmount: '100000',
      swapPayload: {
        case: 'swapkitSwapPayload',
        value: create(SwapKitSwapPayloadSchema, {
          fromCoin: coin,
          fromAmount: '100000',
          targetAddress: fixture.targetAddress,
          txType: chain === Chain.Dogecoin ? 'PSBT_DOGE' : 'PSBT_BCH',
          txPayload: fixture.psbt.toBuffer(),
        }),
      },
    })
    const signBitcoin = getSwapKitSignBitcoin(payload)
    expect(signBitcoin).toBeDefined()
    if (!signBitcoin) return
    expect(signBitcoin.version).toBe(2)
    expect(signBitcoin.locktime).toBe(345)
    expect(signBitcoin.inputs[0].sighashType).toBe(chain === Chain.BitcoinCash ? 0x41 : 1)
    const [hash] = computePreSigningHashes(signBitcoin, chain)
    const output = TW.Bitcoin.Proto.SigningOutput.decode(
      compileSignBitcoinTx(
        signBitcoin,
        {
          [Buffer.from(hash).toString('hex')]: { msg: '', r: '', s: '', der_signature: '3006020101020101' },
        },
        { data: () => pubkey } as never,
        chain
      )
    )
    const signed = Transaction.fromBuffer(Buffer.from(output.encoded))
    expect(signed.version).toBe(2)
    expect(signed.locktime).toBe(345)
    expect(signed.ins[0].sequence).toBe(0xfffffffe)
    expect(signed.ins[0].witness).toEqual([])
    const chunks = script.decompile(signed.ins[0].script)
    expect(Buffer.from(chunks?.[0] as Buffer).at(-1)).toBe(chain === Chain.BitcoinCash ? 0x41 : 1)
    expect(Buffer.from(chunks?.[1] as Buffer)).toEqual(pubkey)
    expect(signed.outs.map(output => Buffer.from(output.script).toString('hex'))).toEqual([
      fixture.destinationScript.toString('hex'),
      fixture.sourceScript.toString('hex'),
    ])
  })

  it('rejects an input without an authenticated previous transaction', () => {
    const psbt = new Psbt()
    psbt.addInput({ hash: 'aa'.repeat(32), index: 0, witnessUtxo: { script: fixture.sourceScript, value: 200_000n } })
    psbt.addOutput({ script: fixture.destinationScript, value: 90_000n })
    expect(() => buildSignBitcoinFromPsbt({ psbt, senderAddress: fixture.senderAddress, chain })).toThrow(
      'requires nonWitnessUtxo'
    )
  })

  it('rejects foreign inputs and value-bearing extra outputs before hashing', () => {
    const psbt = Psbt.fromBuffer(fixture.psbt.toBuffer())
    const foreign = new Transaction()
    foreign.addInput(Buffer.alloc(32, 0x01), 0xffffffff)
    foreign.addOutput(fixture.destinationScript, 200_000n)
    psbt.addInput({ hash: foreign.getId(), index: 0, nonWitnessUtxo: foreign.toBuffer() })
    expect(() => buildSignBitcoinFromPsbt({ psbt, senderAddress: fixture.senderAddress, chain })).toThrow(
      "not the vault's P2PKH"
    )

    const extra = Psbt.fromBuffer(fixture.psbt.toBuffer())
    extra.addOutput({ script: p2pkhScriptForAddress(chain, address(chain, Buffer.alloc(20, 0x33))), value: 1n })
    const signBitcoin = buildSignBitcoinFromPsbt({ psbt: extra, senderAddress: fixture.senderAddress, chain })
    expect(() =>
      verifySwapKitBitcoinPsbtOutputs({
        signBitcoin,
        chain,
        senderAddress: fixture.senderAddress,
        expectedToAddress: fixture.targetAddress,
        expectedToAmount: 100_000n,
        amountMode: 'maximum',
      })
    ).toThrow('one deposit and optional change')
  })

  it('rejects a miner fee larger than the quoted swap amount', () => {
    const signBitcoin = buildSignBitcoinFromPsbt({
      psbt: fixture.psbt,
      senderAddress: fixture.senderAddress,
      chain,
    })
    signBitcoin.outputs[1].amount = 0n
    expect(() =>
      verifySwapKitBitcoinPsbtOutputs({
        signBitcoin,
        chain,
        senderAddress: fixture.senderAddress,
        expectedToAddress: fixture.targetAddress,
        expectedToAmount: 90_000n,
        amountMode: 'maximum',
      })
    ).toThrow('miner fee')
  })

  it('rejects unsupported provider transaction versions', () => {
    const psbt = Psbt.fromBuffer(fixture.psbt.toBuffer())
    psbt.setVersion(3)
    expect(() => buildSignBitcoinFromPsbt({ psbt, senderAddress: fixture.senderAddress, chain })).toThrow(
      'Unsupported legacy SwapKit PSBT version'
    )
  })

  it('binds the input script to the actual vault signing key', () => {
    const signBitcoin = buildSignBitcoinFromPsbt({ psbt: fixture.psbt, senderAddress: fixture.senderAddress, chain })
    expect(() => assertLegacySwapKitSigningKey(signBitcoin, pubkey)).not.toThrow()
    expect(() => assertLegacySwapKitSigningKey(signBitcoin, Buffer.from('03' + '44'.repeat(32), 'hex'))).toThrow(
      'does not belong to the vault signing public key'
    )
  })

  it('matches the independently serialized legacy sighash preimage', () => {
    const signBitcoin = buildSignBitcoinFromPsbt({ psbt: fixture.psbt, senderAddress: fixture.senderAddress, chain })
    const actual = Buffer.from(computePreSigningHashes(signBitcoin, chain)[0]).toString('hex')
    const expected = independentHash(fixture.psbt, fixture.sourceScript, 200_000n, chain)
    const golden =
      chain === Chain.Dogecoin
        ? 'c22ed5f3fc362f899e88d65995d4cea088f5dfae4c205621cc90843204da336e'
        : 'c8e247bd850135a7d482f2a129474035e961fa7ba4fa769cb0441f3f7cb82b39'
    expect(expected).toBe(golden)
    expect(actual).toBe(expected)
  })
})
