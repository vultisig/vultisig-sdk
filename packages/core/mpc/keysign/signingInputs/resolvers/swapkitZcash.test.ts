import { readFileSync } from 'node:fs'
import { create } from '@bufbuild/protobuf'
import { blake2b } from '@noble/hashes/blake2.js'
import { Chain } from '@vultisig/core-chain/Chain'
import { parseSwapKitZcashPsbt } from '@vultisig/core-chain/chains/utxo/tx/parseSwapKitZcashPsbt'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import bs58check from 'bs58check'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { getPreSigningOutput } from '../../preSigningOutput'
import { encodeDERSignature } from '../../../derSignature'
import { compileTx } from '../../../tx/compile/compileTx'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../../../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { buildSwapKitZcashSigningInput } from './swapkitZcash'

vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: vi.fn(async () => '30f33754'),
}))

const fixture = JSON.parse(
  readFileSync(new URL('../../../../chain/chains/utxo/tx/swapkit-zec-sapling.fixture.json', import.meta.url), 'utf8')
) as {
  sourceAddress: string
  tx: string
}
const tx = parseSwapKitZcashPsbt(Buffer.from(fixture.tx, 'base64'))
const targetAddress = bs58check.encode(
  Buffer.concat([Buffer.from([0x1c, 0xb8]), tx.outputs[0].scriptPubKey.subarray(3, 23)])
)
const quotedAmount =
  [tx.outputs[0].amount, tx.inputs[0].amount - tx.outputs.reduce((sum, output) => sum + output.amount, 0n)].reduce(
    (a, b) => (a > b ? a : b)
  ) + 1n

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
const zipHash = (bytes: Buffer, label: string, branchId = 0x5437f330) => {
  const personalization =
    label === 'ZcashSigHash' ? Buffer.concat([Buffer.from(label), u32(branchId)]) : Buffer.from(label)
  return Buffer.from(blake2b(bytes, { dkLen: 32, personalization }))
}

const independentZip243Hash = (inputIndex: number) => {
  const input = tx.inputs[inputIndex]
  const prevouts = Buffer.concat(tx.inputs.map(item => Buffer.concat([item.hash, u32(item.index)])))
  const sequences = Buffer.concat(tx.inputs.map(item => u32(item.sequence)))
  const outputs = Buffer.concat(
    tx.outputs.map(item =>
      Buffer.concat([u64(item.amount), Buffer.from([item.scriptPubKey.length]), item.scriptPubKey])
    )
  )
  const preimage = Buffer.concat([
    u32(0x80000004),
    u32(0x892f2085),
    zipHash(prevouts, 'ZcashPrevoutHash'),
    zipHash(sequences, 'ZcashSequencHash'),
    zipHash(outputs, 'ZcashOutputsHash'),
    Buffer.alloc(96),
    u32(tx.locktime),
    u32(0),
    u64(0n),
    u32(1),
    input.hash,
    u32(input.index),
    Buffer.from([input.scriptPubKey.length]),
    input.scriptPubKey,
    u64(input.amount),
    u32(input.sequence),
  ])
  return zipHash(preimage, 'ZcashSigHash')
}

describe('SwapKit Zcash frozen Sapling signing input', () => {
  let walletCore: WalletCore
  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const coin = create(CoinSchema, { chain: Chain.Zcash, address: fixture.sourceAddress })
  const payload = create(KeysignPayloadSchema, {
    coin,
    toAddress: targetAddress,
    toAmount: quotedAmount.toString(),
    swapPayload: {
      case: 'swapkitSwapPayload',
      value: create(SwapKitSwapPayloadSchema, {
        fromCoin: coin,
        fromAmount: quotedAmount.toString(),
        targetAddress,
        txType: 'PSBT_ZEC',
        txPayload: Buffer.from(fixture.tx, 'base64'),
      }),
    },
  })

  it('binds the captured PSBT outputs and live branch id to WalletCore hashes', async () => {
    const input = await buildSwapKitZcashSigningInput(payload, walletCore)
    expect(Buffer.from(input.plan?.branchId ?? []).toString('hex')).toBe('30f33754')
    expect(input.lockTime).toBe(0)
    expect(input.plan?.amount.toString()).toBe(tx.outputs[0].amount.toString())
    const encoded = TW.Bitcoin.Proto.SigningInput.encode(input).finish()
    const hashes = getPreSigningOutput({ walletCore, chain: Chain.Zcash, txInputData: encoded }).hashPublicKeys
    expect(hashes).toHaveLength(1)
    expect(Buffer.from(hashes[0].dataHash ?? []).length).toBe(32)
    expect(independentZip243Hash(0).toString('hex')).toBe(
      '3d5b442b36228cff94a11162be1d8291aa80f977ac34034aa52b2a9cbb2663ed'
    )
    expect(Buffer.from(hashes[0].dataHash ?? [])).toEqual(independentZip243Hash(0))
  })

  it('rejects a destination that differs from the provider transaction', async () => {
    const wrong = create(KeysignPayloadSchema, {
      ...payload,
      toAddress: fixture.sourceAddress,
    })
    await expect(buildSwapKitZcashSigningInput(wrong, walletCore)).rejects.toThrow('disagrees')
  })

  it('compiles the frozen Sapling plan with the provider output order', async () => {
    const input = await buildSwapKitZcashSigningInput(payload, walletCore)
    const encoded = TW.Bitcoin.Proto.SigningInput.encode(input).finish()
    const hash = getPreSigningOutput({ walletCore, chain: Chain.Zcash, txInputData: encoded }).hashPublicKeys[0]
      .dataHash
    expect(hash).toBeDefined()
    const privateKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(1))
    const publicKey = privateKey.getPublicKeySecp256k1(true)
    const rawSignature = privateKey.sign(hash!, walletCore.Curve.secp256k1)
    const der = encodeDERSignature(rawSignature.slice(0, 32), rawSignature.slice(32, 64))
    const output = TW.Bitcoin.Proto.SigningOutput.decode(
      compileTx({
        publicKey,
        txInputData: encoded,
        signatures: {
          [Buffer.from(hash!).toString('hex')]: {
            msg: '',
            r: '',
            s: '',
            der_signature: Buffer.from(der).toString('hex'),
          },
        },
        chain: Chain.Zcash,
        walletCore,
      })
    )
    const raw = Buffer.from(output.encoded)
    expect(raw.subarray(0, 8).toString('hex')).toBe('0400008085202f89')
    const outputOrder = tx.outputs.map(item =>
      Buffer.concat([
        Buffer.from(item.amount.toString(16).padStart(16, '0').match(/../g)!.reverse().join(''), 'hex'),
        Buffer.from([item.scriptPubKey.length]),
        item.scriptPubKey,
      ])
    )
    expect(raw.indexOf(outputOrder[0])).toBeGreaterThan(0)
    expect(raw.indexOf(outputOrder[1])).toBeGreaterThan(raw.indexOf(outputOrder[0]))
  })
})
