/**
 * SwapKit DOGE / BCH / DASH PSBT signing (sdk#2460).
 *
 * The cross-platform contract is pinned two ways:
 * - WalletCore oracle: for a version-1 PSBT, the sighash and the compiled
 *   transaction must equal what WalletCore's own legacy Bitcoin signer
 *   produces from a frozen plan — the exact path Android signs with.
 * - bitcoinjs-lib oracle: the legacy / fork-id digests must match the
 *   library's `hashForSignature` / `hashForWitnessV0`, and a version-2 PSBT
 *   keeps its version and locktime, as iOS's direct sighash path does.
 */
import { Buffer } from 'buffer'
import { create, toBinary } from '@bufbuild/protobuf'
import { initWasm, TW, WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  buildP2pkhScript,
  encodeP2pkhAddress,
  getPublicKeyHash160,
} from '@vultisig/core-chain/chains/utxo/tx/p2pkhAddress'
import { SwapKitLegacyPsbtChain, swapKitLegacyPsbtTxType } from '@vultisig/core-chain/chains/utxo/tx/swapKitLegacyPsbt'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import fixtures from '@vultisig/core-chain/fixtures/swapkit-utxo-psbts.json'
import { getTwPublicKeyType } from '@vultisig/core-chain/publicKey/tw/getTwPublicKeyType'
import { decodeSigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { selectEncodedBytes } from '@vultisig/core-chain/tx/broadcast/resolvers/utxo'
import { getTxHash } from '@vultisig/core-chain/tx/hash'
import { script as bitcoinScript, Psbt, Transaction } from 'bitcoinjs-lib'
import Long from 'long'
import * as ecc from 'tiny-secp256k1'
import { beforeAll, describe, expect, it } from 'vitest'

import { encodeDERSignature } from '../derSignature'
import { getPreSigningOutput } from '../keysign/preSigningOutput'
import { refineKeysignUtxo } from '../keysign/refine/utxo'
import { getEncodedSigningInputs } from '../keysign/signingInputs'
import { getCompiledTxsForBlockaidInput } from '../security/blockaid/tx/utils/getCompiledTxsForBlockaidInput'
import { CoinSchema } from '../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayload, KeysignPayloadSchema } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayloadSchema } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { SignBitcoin } from '../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { compileTx } from './compile/compileTx'
import { getPreSigningHashes } from './preSigningHashes'
import { getSwapKitLegacyPsbtSignBitcoin, getSwapKitSignBitcoin } from './swapkitSignBitcoin'

const privateKey = new Uint8Array(32)
privateKey[31] = 1
const publicKey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const ownKeyHash = getPublicKeyHash160(publicKey)
const ownScript = buildP2pkhScript(ownKeyHash)
const foreignScript = buildP2pkhScript(Buffer.from('19fb7ab04f2de927ced3b8337ab45d5d046db6cf', 'hex'))

const tickers: Record<SwapKitLegacyPsbtChain, string> = {
  [Chain.Dogecoin]: 'DOGE',
  [Chain.BitcoinCash]: 'BCH',
  [Chain.Dash]: 'DASH',
}

const ownAddress = (chain: SwapKitLegacyPsbtChain) => encodeP2pkhAddress({ chain, keyHash: ownKeyHash })

type MakeLegacyPsbtInput = {
  version?: number
  locktime?: number
  sequence?: number
  inputAmounts: bigint[]
  outputs: { script: Buffer; value: bigint }[]
}

/** An unsigned PSBT spending the test key's P2PKH outputs, with full previous transactions. */
const makeLegacyPsbt = ({
  version = 1,
  locktime = 0,
  sequence = 0xffffffff,
  inputAmounts,
  outputs,
}: MakeLegacyPsbtInput) => {
  const psbt = new Psbt()
  psbt.setVersion(version)
  psbt.setLocktime(locktime)
  inputAmounts.forEach((amount, index) => {
    const prevTx = new Transaction()
    prevTx.version = 2
    prevTx.addInput(Buffer.alloc(32, index + 1), 0)
    prevTx.addOutput(ownScript, amount)
    psbt.addInput({ hash: prevTx.getId(), index: 0, sequence, nonWitnessUtxo: prevTx.toBuffer() })
  })
  outputs.forEach(output => psbt.addOutput(output))
  return psbt.toBuffer()
}

/**
 * The live Dogecoin PSBT re-keyed to the test key: the previous transaction's
 * spent output and the change output move to the test key's script, and the
 * input points at the re-keyed previous transaction. Everything else — version,
 * locktime, sequence, amounts, the deposit output — is the captured route.
 */
const toVaultOwnedDogecoinPsbt = () => {
  const original = Psbt.fromBuffer(Buffer.from(fixtures.dogecoin.psbt, 'base64'))
  const sourceScript = buildP2pkhScript(Buffer.from('c4919dca916dc416c06d51cb1940a7ba268c475d', 'hex'))
  const rebuilt = new Psbt()
  rebuilt.setVersion(original.version)
  rebuilt.setLocktime(original.locktime)
  original.txInputs.forEach((input, index) => {
    const prevTx = Transaction.fromBuffer(Buffer.from(original.data.inputs[index].nonWitnessUtxo!))
    prevTx.outs[input.index].script = ownScript
    rebuilt.addInput({
      hash: prevTx.getId(),
      index: input.index,
      sequence: input.sequence,
      nonWitnessUtxo: prevTx.toBuffer(),
    })
  })
  original.txOutputs.forEach(({ script, value }) =>
    rebuilt.addOutput({ script: Buffer.from(script).equals(sourceScript) ? ownScript : Buffer.from(script), value })
  )
  return rebuilt.toBuffer()
}

type MakeKeysignPayloadInput = {
  chain: SwapKitLegacyPsbtChain
  psbt: Uint8Array
  fromAmount: string
  senderAddress?: string
  txType?: string
}

const makeKeysignPayload = ({
  chain,
  psbt,
  fromAmount,
  senderAddress = ownAddress(chain),
  txType = swapKitLegacyPsbtTxType[chain],
}: MakeKeysignPayloadInput): KeysignPayload => {
  const coin = create(CoinSchema, {
    chain,
    ticker: tickers[chain],
    address: senderAddress,
    decimals: 8,
    isNativeToken: true,
    hexPublicKey: publicKey.toString('hex'),
  })

  return create(KeysignPayloadSchema, {
    coin,
    toAddress: fixtures.dogecoin.targetAddress,
    toAmount: fromAmount,
    swapPayload: {
      case: 'swapkitSwapPayload',
      value: create(SwapKitSwapPayloadSchema, {
        fromCoin: coin,
        fromAmount,
        targetAddress: fixtures.dogecoin.targetAddress,
        txType,
        txPayload: psbt,
      }),
    },
  })
}

type WalletCoreOracleInput = {
  walletCore: WalletCore
  chain: SwapKitLegacyPsbtChain
  signBitcoin: SignBitcoin
}

/**
 * The frozen-plan `SigningInput` Android's `SwapKitLegacyP2PKHSigner` feeds
 * WalletCore: the PSBT's inputs, outputs, fee and locktime, no planning.
 */
const walletCoreLegacySigningInput = ({ walletCore, chain, signBitcoin }: WalletCoreOracleInput) => {
  const coinType = getCoinType({ chain, walletCore })
  const utxos = signBitcoin.inputs.map(input =>
    TW.Bitcoin.Proto.UnspentTransaction.create({
      amount: Long.fromString(input.amount.toString()),
      outPoint: TW.Bitcoin.Proto.OutPoint.create({
        hash: Buffer.from(input.hash, 'hex').reverse(),
        index: input.index,
        sequence: input.sequence,
      }),
      script: Buffer.from(input.scriptPubKey, 'hex'),
    })
  )
  const [deposit, change] = signBitcoin.outputs
  const totalIn = signBitcoin.inputs.reduce((sum, { amount }) => sum + amount, 0n)
  const totalOut = signBitcoin.outputs.reduce((sum, { amount }) => sum + amount, 0n)

  return TW.Bitcoin.Proto.SigningInput.encode(
    TW.Bitcoin.Proto.SigningInput.create({
      hashType: walletCore.BitcoinScript.hashTypeForCoin(coinType),
      amount: Long.fromString(deposit.amount.toString()),
      useMaxAmount: false,
      toAddress: deposit.address,
      changeAddress: change?.address ?? ownAddress(chain),
      byteFee: Long.fromInt(1),
      coinType: coinType.value,
      lockTime: signBitcoin.locktime,
      scripts: { [ownKeyHash.toString('hex')]: walletCore.BitcoinScript.buildPayToPublicKeyHash(ownKeyHash).data() },
      utxo: utxos,
      plan: TW.Bitcoin.Proto.TransactionPlan.create({
        amount: Long.fromString(deposit.amount.toString()),
        availableAmount: Long.fromString(totalIn.toString()),
        fee: Long.fromString((totalIn - totalOut).toString()),
        change: Long.fromString((change?.amount ?? 0n).toString()),
        utxos,
      }),
    })
  ).finish()
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const signHash = (hash: Uint8Array) => {
  const compact = ecc.sign(hash, privateKey)
  return Buffer.from(encodeDERSignature(compact.subarray(0, 32), compact.subarray(32, 64)))
}

const transactionOf = (signBitcoin: SignBitcoin) => {
  const tx = new Transaction()
  tx.version = signBitcoin.version
  tx.locktime = signBitcoin.locktime
  signBitcoin.inputs.forEach(input =>
    tx.addInput(Buffer.from(input.hash, 'hex').reverse(), input.index, input.sequence)
  )
  signBitcoin.outputs.forEach(output => tx.addOutput(Buffer.from(output.scriptPubKey, 'hex'), output.amount))
  return tx
}

const bitcoinjsSighash = (chain: SwapKitLegacyPsbtChain, signBitcoin: SignBitcoin, index: number) => {
  const tx = transactionOf(signBitcoin)
  return chain === Chain.BitcoinCash
    ? tx.hashForWitnessV0(index, ownScript, signBitcoin.inputs[index].amount, 0x41)
    : tx.hashForSignature(index, ownScript, 0x01)
}

type ChainCase = {
  chain: SwapKitLegacyPsbtChain
  psbt: () => Uint8Array
  fromAmount: string
  deposit: bigint
}

const chainCases: ChainCase[] = [
  {
    chain: Chain.Dogecoin,
    psbt: toVaultOwnedDogecoinPsbt,
    fromAmount: fixtures.dogecoin.sellAmount,
    deposit: 99_799_970_000n,
  },
  {
    chain: Chain.BitcoinCash,
    psbt: () =>
      makeLegacyPsbt({
        inputAmounts: [50_000_000n],
        outputs: [
          { script: foreignScript, value: 49_748_500n },
          { script: ownScript, value: 250_000n },
        ],
      }),
    fromAmount: '50000000',
    deposit: 49_748_500n,
  },
  {
    chain: Chain.Dash,
    psbt: () =>
      makeLegacyPsbt({
        inputAmounts: [1_000_000_000n],
        outputs: [
          { script: foreignScript, value: 993_499_600n },
          { script: ownScript, value: 6_500_000n },
        ],
      }),
    fromAmount: '1000000000',
    deposit: 993_499_600n,
  },
]

describe('SwapKit legacy P2PKH PSBT signing', () => {
  let walletCore: WalletCore
  let twPublicKey: ReturnType<WalletCore['PublicKey']['createWithData']>

  beforeAll(async () => {
    walletCore = await initWasm()
    twPublicKey = walletCore.PublicKey.createWithData(
      new Uint8Array(publicKey),
      getTwPublicKeyType({ walletCore, chain: Chain.Dogecoin })
    )
  })

  describe.each(chainCases)('$chain', ({ chain, psbt, fromAmount, deposit }) => {
    const keysignPayload = () => makeKeysignPayload({ chain, psbt: psbt(), fromAmount })

    it('hashes the PSBT exactly as WalletCore hashes the same frozen plan (Android parity)', () => {
      const payload = keysignPayload()
      const signBitcoin = getSwapKitSignBitcoin(payload)!
      expect(signBitcoin.outputs.filter(({ isChange }) => !isChange).map(({ amount }) => amount)).toEqual([deposit])

      const hashes = getPreSigningHashes({ walletCore, chain, txInputData: new Uint8Array(), keysignPayload: payload })
      const oracle = getPreSigningOutput({
        walletCore,
        chain,
        txInputData: walletCoreLegacySigningInput({ walletCore, chain, signBitcoin }),
      }).hashPublicKeys.map(({ dataHash }) => hex(dataHash!))

      expect(hashes.map(hex)).toEqual(oracle)
      expect(hashes.map(hex)).toEqual([hex(bitcoinjsSighash(chain, signBitcoin, 0))])
    })

    it('compiles the transaction WalletCore compiles from the same signature', async () => {
      const payload = keysignPayload()
      const signBitcoin = getSwapKitSignBitcoin(payload)!
      const [hash] = getPreSigningHashes({ walletCore, chain, txInputData: new Uint8Array(), keysignPayload: payload })
      const der = signHash(hash)

      const compiled = compileTx({
        publicKey: twPublicKey,
        txInputData: new Uint8Array(),
        signatures: { [hex(hash)]: { msg: '', r: '', s: '', der_signature: der.toString('hex') } },
        chain,
        walletCore,
        keysignPayload: payload,
      })
      const signingOutput = decodeSigningOutput(chain, compiled)

      const signatures = walletCore.DataVector.create()
      signatures.add(der)
      const publicKeys = walletCore.DataVector.create()
      publicKeys.add(new Uint8Array(publicKey))
      const oracle = TW.Bitcoin.Proto.SigningOutput.decode(
        walletCore.TransactionCompiler.compileWithSignatures(
          getCoinType({ chain, walletCore }),
          walletCoreLegacySigningInput({ walletCore, chain, signBitcoin }),
          signatures,
          publicKeys
        )
      )
      expect(oracle.errorMessage).toBe('')
      expect(hex(selectEncodedBytes(chain, signingOutput))).toBe(hex(oracle.encoded))

      const signed = Transaction.fromBuffer(Buffer.from(oracle.encoded))
      expect(await getTxHash({ chain, tx: signingOutput })).toBe(signed.getId())
      expect(signed.ins[0].witness).toEqual([])
      const [signature, pubkey] = bitcoinScript
        .decompile(signed.ins[0].script)!
        .map(chunk => Buffer.from(chunk as Uint8Array))
      expect(pubkey).toEqual(publicKey)
      expect(signature).toEqual(Buffer.concat([der, Buffer.from([chain === Chain.BitcoinCash ? 0x41 : 0x01])]))
    })

    it('returns the keysign payload as the signing input once the PSBT is bound to the signing key', async () => {
      const payload = keysignPayload()

      await expect(
        getEncodedSigningInputs({ keysignPayload: payload, walletCore, publicKey: twPublicKey })
      ).resolves.toEqual([toBinary(KeysignPayloadSchema, payload)])

      const otherKey = walletCore.PublicKey.createWithData(
        walletCore.PrivateKey.createWithData(new Uint8Array(32).fill(2)).getPublicKeySecp256k1(true).data(),
        getTwPublicKeyType({ walletCore, chain })
      )
      await expect(
        getEncodedSigningInputs({ keysignPayload: payload, walletCore, publicKey: otherKey })
      ).rejects.toThrow("does not lock to this vault's signing key")
      await expect(getEncodedSigningInputs({ keysignPayload: payload, walletCore })).rejects.toThrow(
        'publicKey is required'
      )
    })

    it('leaves the keysign untouched in UTXO refinement', async () => {
      const payload = keysignPayload()

      await expect(refineKeysignUtxo({ keysignPayload: payload, walletCore, publicKey: twPublicKey })).resolves.toBe(
        payload
      )
    })

    it('compiles a throwaway-key preview for Blockaid', async () => {
      const [compiled] = await getCompiledTxsForBlockaidInput({ payload: keysignPayload(), walletCore })
      const preview = Transaction.fromBuffer(Buffer.from(decodeSigningOutput(chain, compiled).encoded!))

      expect(preview.ins).toHaveLength(1)
      expect(preview.outs.map(({ value }) => value)).toEqual(
        getSwapKitSignBitcoin(keysignPayload())!.outputs.map(o => o.amount)
      )
    })
  })

  it('preserves a version-2 PSBT and its locktime (iOS parity)', () => {
    const payload = makeKeysignPayload({
      chain: Chain.Dogecoin,
      psbt: makeLegacyPsbt({
        version: 2,
        locktime: 700_000,
        sequence: 0xfffffffe,
        inputAmounts: [100_000_000n],
        outputs: [
          { script: foreignScript, value: 90_000_000n },
          { script: ownScript, value: 9_000_000n },
        ],
      }),
      fromAmount: '90000000',
    })
    const signBitcoin = getSwapKitSignBitcoin(payload)!
    expect(signBitcoin.version).toBe(2)
    expect(signBitcoin.locktime).toBe(700_000)

    const [hash] = getPreSigningHashes({
      walletCore,
      chain: Chain.Dogecoin,
      txInputData: new Uint8Array(),
      keysignPayload: payload,
    })
    expect(hex(hash)).toBe(hex(bitcoinjsSighash(Chain.Dogecoin, signBitcoin, 0)))

    const compiled = compileTx({
      publicKey: twPublicKey,
      txInputData: new Uint8Array(),
      signatures: { [hex(hash)]: { msg: '', r: '', s: '', der_signature: signHash(hash).toString('hex') } },
      chain: Chain.Dogecoin,
      walletCore,
      keysignPayload: payload,
    })
    const signed = Transaction.fromBuffer(Buffer.from(decodeSigningOutput(Chain.Dogecoin, compiled).encoded!))
    expect(signed.version).toBe(2)
    expect(signed.locktime).toBe(700_000)
    expect(signed.ins[0].sequence).toBe(0xfffffffe)
  })

  it('sorts the hashes of a multi-input PSBT for the ceremony', () => {
    const payload = makeKeysignPayload({
      chain: Chain.Dogecoin,
      psbt: makeLegacyPsbt({
        inputAmounts: [100_000_000n, 200_000_000n],
        outputs: [{ script: foreignScript, value: 299_000_000n }],
      }),
      fromAmount: '299000000',
    })

    const hashes = getPreSigningHashes({
      walletCore,
      chain: Chain.Dogecoin,
      txInputData: new Uint8Array(),
      keysignPayload: payload,
    }).map(hex)

    expect(hashes).toHaveLength(2)
    expect(hashes).toEqual([...hashes].sort())
  })

  it('accepts the txType spellings peers stamp and refuses any other', () => {
    const psbt = toVaultOwnedDogecoinPsbt()
    const payloadWith = (txType: string, bytes = psbt) =>
      makeKeysignPayload({ chain: Chain.Dogecoin, psbt: bytes, fromAmount: fixtures.dogecoin.sellAmount, txType })

    for (const txType of ['', 'PSBT', 'psbt_doge']) {
      expect(getSwapKitLegacyPsbtSignBitcoin(payloadWith(txType))).toBeDefined()
    }
    expect(() => getSwapKitLegacyPsbtSignBitcoin(payloadWith('PSBT_BCH'))).toThrow(
      'Unsupported SwapKit Dogecoin transaction type "PSBT_BCH"'
    )
    expect(() => getSwapKitLegacyPsbtSignBitcoin(payloadWith('TON'))).toThrow(
      'Unsupported SwapKit Dogecoin transaction type'
    )
    // No transaction bytes at all, under whatever txType the old quote
    // reported: the plain deposit transfer older SDKs produced.
    for (const txType of ['', 'TRANSFER', 'PSBT', 'PSBT_DOGE']) {
      expect(getSwapKitLegacyPsbtSignBitcoin(payloadWith(txType, new Uint8Array()))).toBeUndefined()
      expect(getSwapKitSignBitcoin(payloadWith(txType, new Uint8Array()))).toBeUndefined()
    }
  })

  it('binds the PSBT to the quoted amount and the vault address', () => {
    const psbt = toVaultOwnedDogecoinPsbt()

    expect(() =>
      getSwapKitSignBitcoin(makeKeysignPayload({ chain: Chain.Dogecoin, psbt, fromAmount: '99799969999' }))
    ).toThrow('more than the quoted swap amount')
    expect(() =>
      getSwapKitSignBitcoin(
        makeKeysignPayload({
          chain: Chain.Dogecoin,
          psbt,
          fromAmount: fixtures.dogecoin.sellAmount,
          senderAddress: fixtures.dogecoin.targetAddress,
        })
      )
    ).toThrow("does not spend from this vault's address")
  })
})
