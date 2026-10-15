import { Chain } from '@vultisig/core-chain/Chain'
import { Psbt, Transaction } from 'bitcoinjs-lib'
import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import fixtures from '../../../fixtures/swapkit-utxo-psbts.json'
import { buildP2pkhScript, getP2pkhScriptForAddress } from './p2pkhAddress'
import { buildSignBitcoinFromLegacyPsbt, normalizeSwapKitLegacyPsbtVersion } from './swapKitLegacyPsbt'
import { verifySwapKitP2pkhSpend } from './swapKitP2pkhSpend'

const dogeFixture = fixtures.dogecoin
const dogePsbt = Buffer.from(dogeFixture.psbt, 'base64')
const dogeSourceScript = getP2pkhScriptForAddress({ chain: Chain.Dogecoin, address: dogeFixture.sourceAddress })
const foreignScript = buildP2pkhScript(Buffer.alloc(20, 0x22))

type LegacyPsbtInput = {
  script: Buffer
  amount: bigint
  /** `nonWitness` embeds the full previous transaction; `witness` only its output. */
  prevout?: 'nonWitness' | 'witness' | 'both'
  sighashType?: number
}

type MakeLegacyPsbtInput = {
  version?: number
  locktime?: number
  sequence?: number
  inputs: LegacyPsbtInput[]
  outputs: { script: Buffer; value: bigint }[]
}

const makeLegacyPsbt = ({ version = 1, locktime = 0, sequence = 0xffffffff, inputs, outputs }: MakeLegacyPsbtInput) => {
  const psbt = new Psbt()
  psbt.setVersion(version)
  psbt.setLocktime(locktime)

  inputs.forEach(({ script, amount, prevout = 'nonWitness', sighashType }, index) => {
    const prevTx = new Transaction()
    prevTx.version = 2
    prevTx.addInput(Buffer.alloc(32, index + 1), 0)
    prevTx.addOutput(script, amount)

    psbt.addInput({
      hash: prevTx.getId(),
      index: 0,
      sequence,
      ...(prevout !== 'witness' ? { nonWitnessUtxo: prevTx.toBuffer() } : {}),
      ...(prevout !== 'nonWitness' ? { witnessUtxo: { script, value: amount } } : {}),
      ...(sighashType !== undefined ? { sighashType } : {}),
    })
  })
  outputs.forEach(({ script, value }) => psbt.addOutput({ script, value }))

  return psbt.toBuffer()
}

const spendOf = (signBitcoin: ReturnType<typeof buildSignBitcoinFromLegacyPsbt>) => ({
  inputAmounts: signBitcoin.inputs.map(({ amount }) => amount),
  outputs: signBitcoin.outputs.map(({ amount, isChange }) => ({ amount, isChange })),
})

describe('buildSignBitcoinFromLegacyPsbt', () => {
  it('decomposes the live Dogecoin PSBT, keeping its version, locktime, inputs and outputs', () => {
    const signBitcoin = buildSignBitcoinFromLegacyPsbt({
      chain: Chain.Dogecoin,
      psbt: dogePsbt,
      senderAddress: dogeFixture.sourceAddress,
    })

    expect(signBitcoin.version).toBe(1)
    expect(signBitcoin.locktime).toBe(0)
    expect(signBitcoin.inputs).toHaveLength(1)
    expect(signBitcoin.inputs[0]).toMatchObject({
      hash: 'b45a3a44e52707cc2cb75e39b7c7b2004385464b012de9b87875c086c77ae450',
      index: 0,
      amount: 100_000_000_000n,
      scriptPubKey: dogeSourceScript.toString('hex'),
      scriptType: 'p2pkh',
      sighashType: 0x01,
      isOurs: true,
      sequence: 0xffffffff,
    })
    expect(signBitcoin.outputs.map(({ amount, address, isChange }) => ({ amount, address, isChange }))).toEqual([
      { amount: 99_799_970_000n, address: 'D7WUh91sP7W3adPvw8CcNM3KW6nbVsmeA7', isChange: false },
      { amount: 200_000_000n, address: dogeFixture.sourceAddress, isChange: true },
    ])

    expect(
      verifySwapKitP2pkhSpend({ chain: Chain.Dogecoin, ...spendOf(signBitcoin), fromAmount: dogeFixture.sellAmount })
    ).toBe(99_799_970_000n)
  })

  it('binds the live Bitcoin Cash PSBT under either spelling of the vault address, with SIGHASH_FORKID', () => {
    const { psbt, sourceAddress, sellAmount } = fixtures.bitcoinCash

    for (const senderAddress of [sourceAddress, 'qpm2qsznhks23z7629mms6s4cwef74vcwvy22gdx6a']) {
      const signBitcoin = buildSignBitcoinFromLegacyPsbt({
        chain: Chain.BitcoinCash,
        psbt: Buffer.from(psbt, 'base64'),
        senderAddress,
      })

      expect(signBitcoin.inputs[0].sighashType).toBe(0x41)
      expect(signBitcoin.inputs[0].amount).toBe(50_000_000n)
      // This handcrafted fixture pays both outputs back to the vault.
      expect(signBitcoin.outputs.map(({ isChange }) => isChange)).toEqual([true, true])
      expect(() =>
        verifySwapKitP2pkhSpend({ chain: Chain.BitcoinCash, ...spendOf(signBitcoin), fromAmount: sellAmount })
      ).toThrow('pays nothing out of the vault')
    }
  })

  it('decomposes the live Dash PSBT', () => {
    const { psbt, sourceAddress } = fixtures.dash
    const signBitcoin = buildSignBitcoinFromLegacyPsbt({
      chain: Chain.Dash,
      psbt: Buffer.from(psbt, 'base64'),
      senderAddress: sourceAddress,
    })

    expect(signBitcoin.inputs[0]).toMatchObject({ amount: 1_000_000_000n, sighashType: 0x01, scriptType: 'p2pkh' })
    expect(signBitcoin.outputs.map(({ amount, address }) => ({ amount, address }))).toEqual([
      { amount: 993_499_600n, address: sourceAddress },
      { amount: 6_500_000n, address: sourceAddress },
    ])
  })

  it('refuses an input that does not spend from the vault', () => {
    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: dogePsbt,
        senderAddress: dogeFixture.targetAddress,
      })
    ).toThrow("input #0 does not spend from this vault's address")
  })

  it('requires the full previous transaction on Dogecoin and Dash but accepts a WITNESS_UTXO on Bitcoin Cash', () => {
    const outputs = [{ script: foreignScript, value: 90_000n }]
    const witnessOnly = (script: Buffer) =>
      makeLegacyPsbt({ inputs: [{ script, amount: 100_000n, prevout: 'witness' }], outputs })

    const bchScript = getP2pkhScriptForAddress({
      chain: Chain.BitcoinCash,
      address: fixtures.bitcoinCash.sourceAddress,
    })
    expect(
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.BitcoinCash,
        psbt: witnessOnly(bchScript),
        senderAddress: fixtures.bitcoinCash.sourceAddress,
      }).inputs[0].amount
    ).toBe(100_000n)

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: witnessOnly(dogeSourceScript),
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('the full previous transaction is required')

    const dashScript = getP2pkhScriptForAddress({ chain: Chain.Dash, address: fixtures.dash.sourceAddress })
    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dash,
        psbt: witnessOnly(dashScript),
        senderAddress: fixtures.dash.sourceAddress,
      })
    ).toThrow('the full previous transaction is required')
  })

  it('refuses a WITNESS_UTXO that disagrees with the full previous transaction', () => {
    const psbt = Psbt.fromBuffer(dogePsbt)
    psbt.updateInput(0, { witnessUtxo: { script: dogeSourceScript, value: 100_000_000_001n } })

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: psbt.toBuffer(),
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('WITNESS_UTXO disagrees with its previous transaction')
  })

  it('refuses a previous transaction that does not hash to the outpoint', () => {
    const outpointHash = Buffer.from(Psbt.fromBuffer(dogePsbt).txInputs[0].hash)
    const tampered = Buffer.from(dogePsbt)
    const offset = tampered.indexOf(outpointHash)
    expect(offset).toBeGreaterThan(0)
    tampered[offset] ^= 0x01

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: tampered,
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('previous transaction does not hash to its outpoint')
  })

  it('refuses an output that is not P2PKH', () => {
    const psbt = makeLegacyPsbt({
      inputs: [{ script: dogeSourceScript, amount: 100_000n }],
      outputs: [{ script: Buffer.concat([Buffer.from([0x00, 0x14]), Buffer.alloc(20, 0x22)]), value: 90_000n }],
    })

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({ chain: Chain.Dogecoin, psbt, senderAddress: dogeFixture.sourceAddress })
    ).toThrow('output #0 is not a P2PKH output')
  })

  it("refuses a sighash type other than the chain's own", () => {
    const outputs = [{ script: foreignScript, value: 90_000n }]

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: makeLegacyPsbt({ inputs: [{ script: dogeSourceScript, amount: 100_000n, sighashType: 0x41 }], outputs }),
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('requests sighash type 0x41; only 0x1 is supported')

    const bchScript = getP2pkhScriptForAddress({
      chain: Chain.BitcoinCash,
      address: fixtures.bitcoinCash.sourceAddress,
    })
    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.BitcoinCash,
        psbt: makeLegacyPsbt({ inputs: [{ script: bchScript, amount: 100_000n, sighashType: 0x01 }], outputs }),
        senderAddress: fixtures.bitcoinCash.sourceAddress,
      })
    ).toThrow('requests sighash type 0x1; only 0x41 is supported')
  })

  it('refuses an unsupported transaction version and an empty or malformed payload', () => {
    const psbt = makeLegacyPsbt({
      version: 3,
      inputs: [{ script: dogeSourceScript, amount: 100_000n }],
      outputs: [{ script: foreignScript, value: 90_000n }],
    })

    expect(() =>
      buildSignBitcoinFromLegacyPsbt({ chain: Chain.Dogecoin, psbt, senderAddress: dogeFixture.sourceAddress })
    ).toThrow('transaction version 3 is unsupported')
    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: new Uint8Array(),
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('payload is empty')
    expect(() =>
      buildSignBitcoinFromLegacyPsbt({
        chain: Chain.Dogecoin,
        psbt: dogePsbt.subarray(0, 40),
        senderAddress: dogeFixture.sourceAddress,
      })
    ).toThrow('PSBT is malformed')
  })
})

describe('normalizeSwapKitLegacyPsbtVersion', () => {
  const inputs = [{ script: dogeSourceScript, amount: 100_000n }]
  const outputs = [
    { script: foreignScript, value: 90_000n },
    { script: dogeSourceScript, value: 9_000n },
  ]

  it('returns a version-1 PSBT untouched', () => {
    expect(normalizeSwapKitLegacyPsbtVersion(Chain.Dogecoin, dogePsbt)).toBe(dogePsbt)
  })

  it('rewrites a version-2 PSBT whose inputs disable BIP68 to version 1 and changes nothing else', () => {
    const v2 = makeLegacyPsbt({ version: 2, locktime: 700_000, sequence: 0xfffffffe, inputs, outputs })
    const normalized = Psbt.fromBuffer(Buffer.from(normalizeSwapKitLegacyPsbtVersion(Chain.Dogecoin, v2)))
    const original = Psbt.fromBuffer(Buffer.from(v2))

    expect(normalized.version).toBe(1)
    expect(normalized.locktime).toBe(700_000)
    expect(normalized.txInputs).toEqual(original.txInputs)
    expect(normalized.txOutputs).toEqual(original.txOutputs)
    expect(normalized.data.inputs).toEqual(original.data.inputs)
  })

  it('refuses a version-2 PSBT that enables a BIP68 relative locktime', () => {
    const v2 = makeLegacyPsbt({ version: 2, sequence: 0x0000000a, inputs, outputs })

    expect(() => normalizeSwapKitLegacyPsbtVersion(Chain.Dogecoin, v2)).toThrow(
      'input #0 enables a BIP68 relative locktime'
    )
  })

  it('refuses any other version', () => {
    const v3 = makeLegacyPsbt({ version: 3, inputs, outputs })

    expect(() => normalizeSwapKitLegacyPsbtVersion(Chain.Dogecoin, v3)).toThrow('transaction version 3 is unsupported')
  })
})

describe('verifySwapKitP2pkhSpend', () => {
  const chain = Chain.Dogecoin

  it('returns the value leaving the vault', () => {
    expect(
      verifySwapKitP2pkhSpend({
        chain,
        inputAmounts: [100_000n],
        outputs: [
          { amount: 60_000n, isChange: false },
          { amount: 39_000n, isChange: true },
        ],
        fromAmount: '60000',
      })
    ).toBe(60_000n)
  })

  it.each([
    [
      'more than the quoted amount leaving the vault',
      [100_000n],
      [{ amount: 60_001n, isChange: false }],
      '60000',
      'more than the quoted swap amount',
    ],
    [
      'a fee above the quoted amount',
      [100_000n],
      [{ amount: 30_000n, isChange: false }],
      '60000',
      'miner fee 70000 exceeds',
    ],
    [
      'only change outputs',
      [100_000n],
      [{ amount: 99_000n, isChange: true }],
      '60000',
      'pays nothing out of the vault',
    ],
    [
      'outputs worth more than the inputs',
      [100_000n],
      [{ amount: 100_001n, isChange: false }],
      '200000',
      'from inputs worth only',
    ],
    [
      'a zero-valued output',
      [100_000n],
      [
        { amount: 0n, isChange: true },
        { amount: 90_000n, isChange: false },
      ],
      '100000',
      'zero-valued output',
    ],
    [
      'three outputs',
      [100_000n],
      [
        { amount: 1n, isChange: false },
        { amount: 1n, isChange: false },
        { amount: 1n, isChange: true },
      ],
      '100000',
      'at most one change output',
    ],
    [
      'an unparseable quoted amount',
      [100_000n],
      [{ amount: 60_000n, isChange: false }],
      '6e4',
      'quoted amount is invalid',
    ],
  ])('refuses %s', (_, inputAmounts, outputs, fromAmount, message) => {
    expect(() => verifySwapKitP2pkhSpend({ chain, inputAmounts, outputs, fromAmount })).toThrow(message)
  })
})
