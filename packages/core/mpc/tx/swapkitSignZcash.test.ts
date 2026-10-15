/**
 * SwapKit Zcash PSBT signing (sdk#2460). WalletCore signs the PSBT from a
 * frozen Sapling plan, as iOS's and Android's `SwapKitZcashSigner` do; the
 * digest it produces is checked against an independent ZIP-243 implementation
 * over the PSBT's own fields.
 */
import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { blake2b } from '@noble/hashes/blake2.js'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  buildP2pkhScript,
  encodeP2pkhAddress,
  getP2pkhScriptForAddress,
  getPublicKeyHash160,
} from '@vultisig/core-chain/chains/utxo/tx/p2pkhAddress'
import { parseSwapKitZcashPsbt, SwapKitZcashPsbt } from '@vultisig/core-chain/chains/utxo/tx/swapKitZcashPsbt'
import fixtures from '@vultisig/core-chain/fixtures/swapkit-utxo-psbts.json'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import * as ecc from 'tiny-secp256k1'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { encodeDERSignature } from '../derSignature'
import { getPreSigningOutput } from '../keysign/preSigningOutput'
import { refineKeysignUtxo } from '../keysign/refine/utxo'
import { getEncodedSigningInputs } from '../keysign/signingInputs'
import { CoinSchema } from '../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayload, KeysignPayloadSchema } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { compileTx } from './compile/compileTx'
import { getPreSigningHashes } from './preSigningHashes'
import { buildSwapKitZcashSigningInput, getSwapKitZcashPsbtPayload } from './swapkitSignZcash'

// NU6.1's consensus branch id (0x4DEC4DF0) in the little-endian order WalletCore takes it.
const branchIdHex = 'f04dec4d'

vi.mock('@vultisig/core-chain/chains/utxo/zcashBranchId', () => ({
  getZcashBranchIdHex: vi.fn(async () => branchIdHex),
}))

const privateKey = new Uint8Array(32)
privateKey[31] = 1
const publicKey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const ownKeyHash = getPublicKeyHash160(publicKey)
const ownScript = buildP2pkhScript(ownKeyHash)
const ownAddress = encodeP2pkhAddress({ chain: Chain.Zcash, keyHash: ownKeyHash })

const fixture = fixtures.zcash
const sourceScript = getP2pkhScriptForAddress({ chain: Chain.Zcash, address: fixture.sourceAddress })

/** The live PSBT re-keyed to the test key: its WITNESS_UTXO and change scripts become the test key's. */
const toVaultOwnedPsbt = () => {
  const bytes = Buffer.from(fixture.psbt, 'base64')
  for (let offset = bytes.indexOf(sourceScript); offset !== -1; offset = bytes.indexOf(sourceScript, offset + 1)) {
    ownScript.copy(bytes, offset)
  }
  return bytes
}

type MakeKeysignPayloadInput = {
  psbt?: Uint8Array
  fromAmount?: string
  senderAddress?: string
  txType?: string
}

const makeKeysignPayload = ({
  psbt = toVaultOwnedPsbt(),
  fromAmount = fixture.sellAmount,
  senderAddress = ownAddress,
  txType = 'PSBT_ZEC',
}: MakeKeysignPayloadInput = {}): KeysignPayload => {
  const coin = create(CoinSchema, {
    chain: Chain.Zcash,
    ticker: 'ZEC',
    address: senderAddress,
    decimals: 8,
    isNativeToken: true,
    hexPublicKey: publicKey.toString('hex'),
  })

  return create(KeysignPayloadSchema, {
    coin,
    toAddress: fixture.targetAddress,
    toAmount: fromAmount,
    swapPayload: {
      case: 'swapkitSwapPayload',
      value: create(SwapKitSwapPayloadSchema, {
        fromCoin: coin,
        fromAmount,
        targetAddress: fixture.targetAddress,
        txType,
        txPayload: psbt,
      }),
    },
  })
}

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
const varSlice = (bytes: Buffer) => Buffer.concat([Buffer.from([bytes.length]), bytes])
const personalizedBlake2b = (bytes: Buffer, personalization: Buffer) =>
  Buffer.from(blake2b(bytes, { dkLen: 32, personalization }))

/** ZIP-243 signature digest of a transparent-only Sapling v4 transaction, SIGHASH_ALL. */
const zip243Sighash = (tx: SwapKitZcashPsbt, index: number) => {
  const input = tx.inputs[index]
  const hashPrevouts = personalizedBlake2b(
    Buffer.concat(tx.inputs.map(({ hash, index }) => Buffer.concat([hash, u32(index)]))),
    Buffer.from('ZcashPrevoutHash')
  )
  const hashSequence = personalizedBlake2b(
    Buffer.concat(tx.inputs.map(({ sequence }) => u32(sequence))),
    Buffer.from('ZcashSequencHash')
  )
  const hashOutputs = personalizedBlake2b(
    Buffer.concat(tx.outputs.map(({ amount, scriptPubKey }) => Buffer.concat([u64(amount), varSlice(scriptPubKey)]))),
    Buffer.from('ZcashOutputsHash')
  )
  const preimage = Buffer.concat([
    u32(0x80000004),
    u32(0x892f2085),
    hashPrevouts,
    hashSequence,
    hashOutputs,
    Buffer.alloc(32), // hashJoinSplits
    Buffer.alloc(32), // hashShieldedSpends
    Buffer.alloc(32), // hashShieldedOutputs
    u32(tx.locktime),
    u32(0), // expiry height
    u64(0n), // value balance
    u32(1), // SIGHASH_ALL
    input.hash,
    u32(input.index),
    varSlice(input.scriptPubKey),
    u64(input.amount),
    u32(input.sequence),
  ])

  return personalizedBlake2b(preimage, Buffer.concat([Buffer.from('ZcashSigHash'), Buffer.from(branchIdHex, 'hex')]))
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('SwapKit Zcash PSBT signing', () => {
  let walletCore: WalletCore
  let twPublicKey: ReturnType<WalletCore['PublicKey']['createWithData']>

  beforeAll(async () => {
    walletCore = await initWasm()
    twPublicKey = walletCore.PublicKey.createWithData(
      new Uint8Array(publicKey),
      getTwPublicKeyType({ walletCore, chain: Chain.Zcash })
    )
  })

  it('freezes the PSBT into the plan WalletCore hashes to its ZIP-243 digest', async () => {
    const payload = makeKeysignPayload()
    const input = await buildSwapKitZcashSigningInput({ keysignPayload: payload, walletCore, publicKey })

    expect(hex(input.plan!.branchId!)).toBe(branchIdHex)
    expect(input.lockTime).toBe(0)
    expect(input.plan!.amount.toString()).toBe('100000000')
    expect(input.plan!.change.toString()).toBe('25699331')
    expect(input.plan!.fee.toString()).toBe('33900')
    expect(input.toAddress).toBe('t1LEzADVN42PMeGGE8y2AxPydsdFNyAvpE3')
    expect(input.changeAddress).toBe(ownAddress)

    const encoded = TW.Bitcoin.Proto.SigningInput.encode(input).finish()
    const hashes = getPreSigningOutput({ walletCore, chain: Chain.Zcash, txInputData: encoded }).hashPublicKeys
    const tx = parseSwapKitZcashPsbt(toVaultOwnedPsbt())

    expect(hashes.map(({ dataHash }) => hex(dataHash!))).toEqual([hex(zip243Sighash(tx, 0))])
  })

  it('signs the PSBT through the standard pipeline and compiles the Sapling transaction', async () => {
    const payload = makeKeysignPayload()
    const tx = parseSwapKitZcashPsbt(toVaultOwnedPsbt())

    const [txInputData] = await getEncodedSigningInputs({ keysignPayload: payload, walletCore, publicKey: twPublicKey })
    const [hash] = getPreSigningHashes({ walletCore, chain: Chain.Zcash, txInputData, keysignPayload: payload })
    expect(hex(hash)).toBe(hex(zip243Sighash(tx, 0)))

    const compact = ecc.sign(hash, privateKey)
    const der = Buffer.from(encodeDERSignature(compact.subarray(0, 32), compact.subarray(32, 64)))
    const compiled = compileTx({
      publicKey: twPublicKey,
      txInputData,
      signatures: { [hex(hash)]: { msg: '', r: '', s: '', der_signature: der.toString('hex') } },
      chain: Chain.Zcash,
      walletCore,
      keysignPayload: payload,
    })
    const signingOutput = decodeSigningOutput(Chain.Zcash, compiled)
    const raw = Buffer.from(signingOutput.encoded!)

    // Sapling v4 header and group id, then the PSBT's single input.
    expect(raw.subarray(0, 8).toString('hex')).toBe('0400008085202f89')
    expect(raw[8]).toBe(1)
    expect(raw.subarray(9, 41).equals(tx.inputs[0].hash)).toBe(true)
    // Both outputs, in the PSBT's order, followed by locktime and expiry height 0.
    const outputs = tx.outputs.map(({ amount, scriptPubKey }) => Buffer.concat([u64(amount), varSlice(scriptPubKey)]))
    const outputsOffset = raw.indexOf(Buffer.concat([Buffer.from([2]), ...outputs]))
    expect(outputsOffset).toBeGreaterThan(41)
    expect(
      raw
        .subarray(
          outputsOffset + 1 + outputs[0].length + outputs[1].length,
          outputsOffset + 9 + outputs[0].length + outputs[1].length
        )
        .toString('hex')
    ).toBe('0000000000000000')
    expect(await getTxHash({ chain: Chain.Zcash, tx: signingOutput })).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a PSBT that does not lock to the signing key', async () => {
    const otherKey = walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2)).getPublicKeySecp256k1(true).data()

    await expect(
      buildSwapKitZcashSigningInput({ keysignPayload: makeKeysignPayload(), walletCore, publicKey: otherKey })
    ).rejects.toThrow("do not lock to this vault's signing key")
    await expect(getEncodedSigningInputs({ keysignPayload: makeKeysignPayload(), walletCore })).rejects.toThrow(
      'publicKey is required'
    )
  })

  it('binds the PSBT to the quoted amount and the vault address', async () => {
    await expect(
      buildSwapKitZcashSigningInput({
        keysignPayload: makeKeysignPayload({ fromAmount: '99999999' }),
        walletCore,
        publicKey,
      })
    ).rejects.toThrow('more than the quoted swap amount')
    await expect(
      buildSwapKitZcashSigningInput({
        keysignPayload: makeKeysignPayload({ senderAddress: fixture.sourceAddress }),
        walletCore,
        publicKey,
      })
    ).rejects.toThrow("does not spend from this vault's address")
  })

  it('accepts the txType spellings peers stamp and refuses any other', () => {
    for (const txType of ['', 'PSBT', 'psbt_zec']) {
      expect(getSwapKitZcashPsbtPayload(makeKeysignPayload({ txType }))).toBeDefined()
    }
    expect(() => getSwapKitZcashPsbtPayload(makeKeysignPayload({ txType: 'PSBT_DOGE' }))).toThrow(
      'Unsupported SwapKit Zcash transaction type "PSBT_DOGE"'
    )
    // No transaction bytes at all: the plain deposit transfer older SDKs produced.
    expect(getSwapKitZcashPsbtPayload(makeKeysignPayload({ txType: '', psbt: new Uint8Array() }))).toBeUndefined()
  })

  it('leaves the keysign untouched in UTXO refinement', async () => {
    const payload = makeKeysignPayload()

    await expect(refineKeysignUtxo({ keysignPayload: payload, walletCore, publicKey: twPublicKey })).resolves.toBe(
      payload
    )
  })
})
