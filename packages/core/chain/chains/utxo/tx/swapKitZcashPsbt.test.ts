import { Chain } from '@vultisig/core-chain/Chain'
import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import fixtures from '../../../fixtures/swapkit-utxo-psbts.json'
import { buildP2pkhScript, getP2pkhScriptForAddress } from './p2pkhAddress'
import { parseSwapKitZcashPsbt, verifySwapKitZcashPsbt } from './swapKitZcashPsbt'

const fixture = fixtures.zcash
const psbt = Buffer.from(fixture.psbt, 'base64')
const sourceScript = getP2pkhScriptForAddress({ chain: Chain.Zcash, address: fixture.sourceAddress })
const depositScript = buildP2pkhScript(Buffer.from('19fb7ab04f2de927ced3b8337ab45d5d046db6cf', 'hex'))

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
const varInt = (value: number) => {
  if (value < 0xfd) return Buffer.from([value])
  const bytes = Buffer.alloc(3)
  bytes[0] = 0xfd
  bytes.writeUInt16LE(value, 1)
  return bytes
}
const varBytes = (bytes: Buffer) => Buffer.concat([varInt(bytes.length), bytes])
const psbtMap = (entries: [Buffer, Buffer][]) =>
  Buffer.concat([...entries.flatMap(([key, value]) => [varBytes(key), varBytes(value)]), Buffer.from([0])])

type ZcashPsbtInput = {
  hash: Buffer
  index: number
  sequence?: number
  amount: bigint
  script: Buffer
  prevout?: 'witness' | 'nonWitness'
  extraEntries?: [Buffer, Buffer][]
}

type EncodeZcashPsbtInput = {
  header?: number
  versionGroupId?: number
  inputs: ZcashPsbtInput[]
  outputs: { amount: bigint; script: Buffer }[]
  locktime?: number
  expiryHeight?: number
  valueBalance?: bigint
  shieldedCounts?: [number, number, number]
  txTrailer?: Buffer
  trailer?: Buffer
}

/** A BIP-174 envelope around a Sapling v4 transaction, the shape SwapKit ships for Zcash. */
const encodeZcashPsbt = ({
  header = 0x80000004,
  versionGroupId = 0x892f2085,
  inputs,
  outputs,
  locktime = 0,
  expiryHeight = 0,
  valueBalance = 0n,
  shieldedCounts = [0, 0, 0],
  txTrailer = Buffer.alloc(0),
  trailer = Buffer.alloc(0),
}: EncodeZcashPsbtInput) => {
  const unsignedTx = Buffer.concat([
    u32(header),
    u32(versionGroupId),
    varInt(inputs.length),
    ...inputs.map(input => Buffer.concat([input.hash, u32(input.index), varInt(0), u32(input.sequence ?? 0xffffffff)])),
    varInt(outputs.length),
    ...outputs.map(output => Buffer.concat([u64(output.amount), varBytes(output.script)])),
    u32(locktime),
    u32(expiryHeight),
    u64(valueBalance),
    ...shieldedCounts.map(varInt),
    txTrailer,
  ])
  const inputMaps = inputs.map(({ amount, script, prevout = 'witness', extraEntries = [] }) => {
    const utxo = Buffer.concat([u64(amount), varBytes(script)])
    return psbtMap([[Buffer.from([prevout === 'witness' ? 0x01 : 0x00]), utxo], ...extraEntries])
  })

  return Buffer.concat([
    Buffer.from('70736274ff', 'hex'),
    psbtMap([[Buffer.from([0x00]), unsignedTx]]),
    ...inputMaps,
    ...outputs.map(() => psbtMap([])),
    trailer,
  ])
}

const liveInput: ZcashPsbtInput = {
  hash: Buffer.from('31c06af949192a71d41d1119aea2670eee3d975b5b7dbd5c668b1af96451b82e', 'hex'),
  index: 0,
  amount: 125_733_231n,
  script: sourceScript,
}
const liveOutputs = [
  { amount: 100_000_000n, script: depositScript },
  { amount: 25_699_331n, script: sourceScript },
]

describe('parseSwapKitZcashPsbt', () => {
  it('parses the live Zcash PSBT', () => {
    const tx = parseSwapKitZcashPsbt(psbt)

    expect(tx.locktime).toBe(0)
    expect(tx.inputs).toHaveLength(1)
    expect(tx.inputs[0].hash.toString('hex')).toBe(liveInput.hash.toString('hex'))
    expect(tx.inputs[0]).toMatchObject({ index: 0, sequence: 0xffffffff, amount: 125_733_231n })
    expect(tx.inputs[0].scriptPubKey.equals(sourceScript)).toBe(true)
    expect(tx.outputs.map(({ amount, scriptPubKey }) => ({ amount, script: scriptPubKey.toString('hex') }))).toEqual([
      { amount: 100_000_000n, script: depositScript.toString('hex') },
      { amount: 25_699_331n, script: sourceScript.toString('hex') },
    ])
  })

  it('reads the same transaction from a re-encoded envelope', () => {
    const encoded = encodeZcashPsbt({ inputs: [liveInput], outputs: liveOutputs })

    expect(parseSwapKitZcashPsbt(encoded)).toEqual(parseSwapKitZcashPsbt(psbt))
  })

  it.each([
    ['a NU5 transaction', { header: 0x80000005, versionGroupId: 0x26a7270a }, 'only transparent Sapling v4'],
    ['a non-zero expiry height', { expiryHeight: 100 }, 'expiry height 100 is unsupported'],
    ['shielded spends', { shieldedCounts: [1, 0, 0] as [number, number, number] }, 'shielded components'],
    ['a value balance', { valueBalance: 1n }, 'shielded components'],
    ['trailing transaction bytes', { txTrailer: Buffer.from([0x00]) }, 'transaction has trailing bytes'],
    ['trailing envelope bytes', { trailer: Buffer.from([0x00]) }, 'has trailing bytes'],
    ['no outputs', { outputs: [] }, 'invalid output count 0'],
    [
      'an input without a WITNESS_UTXO',
      { inputs: [{ ...liveInput, prevout: 'nonWitness' as const }] },
      'a WITNESS_UTXO is required',
    ],
    [
      'an input that is already signed',
      {
        inputs: [
          {
            ...liveInput,
            extraEntries: [[Buffer.concat([Buffer.from([0x02]), Buffer.alloc(33, 0x02)]), Buffer.alloc(71)]] as [
              Buffer,
              Buffer,
            ][],
          },
        ],
      },
      'already signed or finalized',
    ],
    [
      'an input requesting another sighash type',
      { inputs: [{ ...liveInput, extraEntries: [[Buffer.from([0x03]), u32(0x41)]] as [Buffer, Buffer][] }] },
      'unsupported sighash type',
    ],
    ['a repeated outpoint', { inputs: [liveInput, liveInput] }, 'repeats an outpoint'],
  ])('refuses %s', (_, overrides, message) => {
    const encoded = encodeZcashPsbt({ inputs: [liveInput], outputs: liveOutputs, ...overrides })

    expect(() => parseSwapKitZcashPsbt(encoded)).toThrow(message)
  })

  it('refuses an empty, truncated or mislabelled payload', () => {
    expect(() => parseSwapKitZcashPsbt(new Uint8Array())).toThrow('payload is empty')
    expect(() => parseSwapKitZcashPsbt(psbt.subarray(0, 100))).toThrow('is truncated')
    expect(() => parseSwapKitZcashPsbt(Buffer.concat([Buffer.from('70736274fe', 'hex'), psbt.subarray(5)]))).toThrow(
      'magic bytes are invalid'
    )
  })
})

describe('verifySwapKitZcashPsbt', () => {
  const tx = parseSwapKitZcashPsbt(psbt)

  it('binds the live PSBT to the vault address and the quoted amount', () => {
    const { deposit, senderScript } = verifySwapKitZcashPsbt({
      tx,
      senderAddress: fixture.sourceAddress,
      fromAmount: fixture.sellAmount,
    })

    expect(deposit).toBe(100_000_000n)
    expect(senderScript.equals(sourceScript)).toBe(true)
  })

  it('refuses a deposit above the quoted amount', () => {
    expect(() => verifySwapKitZcashPsbt({ tx, senderAddress: fixture.sourceAddress, fromAmount: 99_999_999n })).toThrow(
      'more than the quoted swap amount'
    )
  })

  it('refuses inputs that do not spend from the vault', () => {
    expect(() =>
      verifySwapKitZcashPsbt({ tx, senderAddress: fixture.targetAddress, fromAmount: fixture.sellAmount })
    ).toThrow("input #0 does not spend from this vault's address")
  })

  it('refuses an output that is not P2PKH', () => {
    const segwitOutput = {
      amount: 100_000_000n,
      script: Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0x22)]),
    }
    const altered = parseSwapKitZcashPsbt(
      encodeZcashPsbt({ inputs: [liveInput], outputs: [segwitOutput, liveOutputs[1]] })
    )

    expect(() =>
      verifySwapKitZcashPsbt({ tx: altered, senderAddress: fixture.sourceAddress, fromAmount: fixture.sellAmount })
    ).toThrow('output #0 is not a P2PKH output')
  })
})
