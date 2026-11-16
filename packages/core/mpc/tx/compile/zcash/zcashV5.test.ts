import { Buffer } from 'buffer'
import { readFileSync } from 'fs'
import { join } from 'path'

import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import Long from 'long'
import { beforeAll, describe, expect, it } from 'vitest'

import { KeysignSignature } from '../../../keysign/KeysignSignature'
import { getPreSigningHashes } from '../../preSigningHashes'
import { compileTx } from '../compileTx'

type Fixture = {
  name: string
  walletCoreBranchIdLittleEndian: string
  privateKey: string
  publicKey: string
  fromAddress: string
  toAddress: string
  plan: {
    amount: number
    change: number
    memo: string | null
    utxos: { txid: string; vout: number; amount: number; script: string; sequence: number }[]
  }
  expected: { sighashes: string[]; derSignatures: string[]; txid: string; raw: string }
}

const { fixtures } = JSON.parse(readFileSync(join(__dirname, 'fixtures/zcashV5Golden.json'), 'utf8')) as {
  fixtures: Fixture[]
}

const fixtureByName = (name: string) => {
  const fixture = fixtures.find(f => f.name === name)
  if (!fixture) throw new Error(`HARNESS: fixture ${name} missing`)
  return fixture
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const bytes = (value: string) => Buffer.from(value, 'hex')

// Mirrors getUtxoSigningInputs: WalletCore's plan (utxos, amount, change, memo) with the live branch id stamped on it.
const toSigningInput = (
  walletCore: WalletCore,
  fixture: Fixture,
  editPlan: (plan: TW.Bitcoin.Proto.TransactionPlan) => void = () => {}
) => {
  const coinType = walletCore.CoinType.zcash
  const memo = fixture.plan.memo ? new TextEncoder().encode(fixture.plan.memo) : new Uint8Array()
  const utxos = fixture.plan.utxos.map(utxo =>
    TW.Bitcoin.Proto.UnspentTransaction.create({
      amount: Long.fromNumber(utxo.amount),
      outPoint: TW.Bitcoin.Proto.OutPoint.create({
        hash: bytes(utxo.txid).reverse(),
        index: utxo.vout,
        sequence: utxo.sequence,
      }),
      script: bytes(utxo.script),
    })
  )

  const plan = TW.Bitcoin.Proto.TransactionPlan.create({
    amount: Long.fromNumber(fixture.plan.amount),
    change: Long.fromNumber(fixture.plan.change),
    utxos,
    branchId: bytes(fixture.walletCoreBranchIdLittleEndian),
    outputOpReturn: memo,
  })
  editPlan(plan)

  return TW.Bitcoin.Proto.SigningInput.create({
    hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
    amount: Long.fromNumber(fixture.plan.amount),
    toAddress: fixture.toAddress,
    changeAddress: fixture.fromAddress,
    byteFee: Long.fromNumber(1),
    zip_0317: true,
    coinType: coinType.value,
    lockTime: 0,
    utxo: utxos,
    outputOpReturn: memo,
    plan,
  })
}

const encode = (input: TW.Bitcoin.Proto.SigningInput) => TW.Bitcoin.Proto.SigningInput.encode(input).finish()

const keysignSignature = (hash: Uint8Array, der: Uint8Array): KeysignSignature => ({
  msg: hex(hash),
  r: '',
  s: '',
  der_signature: hex(der),
})

describe('Zcash v5 (ZIP-225 / ZIP-244) transparent signing', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  const hashesFor = (txInputData: Uint8Array) => getPreSigningHashes({ walletCore, chain: Chain.Zcash, txInputData })

  const signAll = (fixture: Fixture, hashes: Uint8Array[]) => {
    const privateKey = walletCore.PrivateKey.createWithData(bytes(fixture.privateKey))
    return hashes.map(hash => privateKey.signAsDER(hash))
  }

  const publicKeyFor = (fixture: Fixture) =>
    walletCore.PrivateKey.createWithData(bytes(fixture.privateKey)).getPublicKeySecp256k1(true)

  const compile = (fixture: Fixture, txInputData: Uint8Array, signatures: Record<string, KeysignSignature>) =>
    TW.Bitcoin.Proto.SigningOutput.decode(
      compileTx({
        publicKey: publicKeyFor(fixture),
        txInputData,
        signatures,
        chain: Chain.Zcash,
        walletCore,
      })
    )

  it.each(fixtures.map(fixture => [fixture.name, fixture] as const))(
    'reproduces sighashes, signatures, raw bytes and txid: %s',
    (_, fixture) => {
      const txInputData = encode(toSigningInput(walletCore, fixture))

      const hashes = hashesFor(txInputData)
      expect(hashes.map(hex)).toEqual(fixture.expected.sighashes)

      const ders = signAll(fixture, hashes)
      expect(ders.map(hex)).toEqual(fixture.expected.derSignatures)
      expect(hex(publicKeyFor(fixture).data())).toBe(fixture.publicKey)

      const output = compile(
        fixture,
        txInputData,
        Object.fromEntries(hashes.map((hash, index) => [hex(hash), keysignSignature(hash, ders[index])]))
      )

      expect(hex(output.encoded)).toBe(fixture.expected.raw)
      expect(output.transactionId).toBe(fixture.expected.txid)
    }
  )

  describe('fails closed', () => {
    const memoFixture = fixtureByName('two_inputs_change_memo_nu7')

    // Mutation: drop the P2PKH input-script check.
    it('rejects a non-P2PKH input script', () => {
      const input = toSigningInput(walletCore, memoFixture, plan => {
        plan.utxos[1].script = bytes(`a914${'11'.repeat(20)}87`)
      })

      expect(() => hashesFor(encode(input))).toThrow('only transparent P2PKH inputs are supported')
    })

    // Mutation: drop the 80-byte OP_RETURN limit.
    it('rejects a memo longer than 80 bytes', () => {
      const input = toSigningInput(walletCore, memoFixture, plan => {
        plan.outputOpReturn = new Uint8Array(81).fill(0x61)
      })

      expect(() => hashesFor(encode(input))).toThrow('OP_RETURN memo is 81 bytes, max is 80')
    })

    // Mutation: drop the branch id length check.
    it.each([
      ['missing', ''],
      ['3 bytes', 'd90a19'],
      ['5 bytes', 'd90a197700'],
    ])('rejects a branch id that is %s', (_, branchIdHex) => {
      const input = toSigningInput(walletCore, memoFixture, plan => {
        plan.branchId = bytes(branchIdHex)
      })

      expect(() => hashesFor(encode(input))).toThrow('branch id must be 4 bytes')
    })

    // Mutation: drop the empty-plan check.
    it('rejects a plan with no inputs', () => {
      const input = toSigningInput(walletCore, memoFixture, plan => {
        plan.utxos = []
      })

      expect(() => hashesFor(encode(input))).toThrow('transaction plan has no inputs')
    })

    // Mutation: drop the empty lock-script check (the output would get an empty, anyone-can-spend script).
    it.each([
      ['recipient', memoFixture.toAddress],
      ['change', memoFixture.fromAddress],
    ])('rejects a %s address WalletCore returns no lock script for', (_, address) => {
      const realBitcoinScript = walletCore.BitcoinScript
      const bitcoinScript: WalletCore['BitcoinScript'] = Object.assign(Object.create(realBitcoinScript), {
        lockScriptForAddress: (target: string, coin: Parameters<typeof realBitcoinScript.lockScriptForAddress>[1]) =>
          target === address ? realBitcoinScript.create() : realBitcoinScript.lockScriptForAddress(target, coin),
      })
      const stubbedWalletCore: WalletCore = Object.assign(Object.create(walletCore), { BitcoinScript: bitcoinScript })
      const txInputData = encode(toSigningInput(walletCore, memoFixture))

      expect(() => getPreSigningHashes({ walletCore: stubbedWalletCore, chain: Chain.Zcash, txInputData })).toThrow(
        `Zcash v5: output address ${address} has no lock script`
      )
    })

    // Mutation: drop the shouldBePresent lookup of each input's signature.
    it('rejects a missing signature for an input', () => {
      const txInputData = encode(toSigningInput(walletCore, memoFixture))
      const hashes = hashesFor(txInputData)
      const [firstDer] = signAll(memoFixture, hashes)

      expect(() =>
        compile(memoFixture, txInputData, { [hex(hashes[0])]: keysignSignature(hashes[0], firstDer) })
      ).toThrow(`signature for input 1 (${hex(hashes[1])}) is required`)
    })

    // Mutation: drop assertSignature (verifyAsDER against the input's sighash).
    it('rejects a signature that does not verify against its sighash', () => {
      const txInputData = encode(toSigningInput(walletCore, memoFixture))
      const hashes = hashesFor(txInputData)
      const [firstDer, secondDer] = signAll(memoFixture, hashes)

      expect(() =>
        compile(memoFixture, txInputData, {
          [hex(hashes[0])]: keysignSignature(hashes[0], secondDer),
          [hex(hashes[1])]: keysignSignature(hashes[1], firstDer),
        })
      ).toThrow('Signature verification failed')
    })
  })
})
