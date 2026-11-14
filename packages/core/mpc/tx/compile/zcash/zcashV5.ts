import { Buffer } from 'buffer'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'
import { assertSignature } from '@vultisig/core-chain/utils/assertSignature'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'

import { KeysignSignature } from '../../../keysign/KeysignSignature'
import { writeUInt32LE, writeUInt64LE, writeVarInt } from '../../../keysign/signingInputs/resolvers/bitcoin/sighash'
import { generateSignature } from '../../signature/generateSignature'

// Transparent-only v5 (ZIP-225 format, ZIP-244 digests). WalletCore only emits
// v4, which NU7 rejects; WalletCore still plans, this module hashes and compiles.
const V5_HEADER = 0x80000005
const V5_VERSION_GROUP_ID = 0x26a7270a
const NO_EXPIRY_HEIGHT = 0
const SIGHASH_ALL = 0x01
const BRANCH_ID_LENGTH = 4
const MAX_OP_RETURN_LENGTH = 80
const OP_RETURN = 0x6a
const OP_PUSHDATA1 = 0x4c
const BLAKE2B_256_LENGTH = 32

type ZcashV5Input = {
  prevout: Buffer
  amount: bigint
  script: Buffer
  sequence: number
}

type ZcashV5Output = {
  amount: bigint
  script: Buffer
}

type ZcashV5Tx = {
  branchIdLE: Buffer
  lockTime: number
  inputs: ZcashV5Input[]
  outputs: ZcashV5Output[]
}

const lengthPrefixed = (bytes: Uint8Array) => Buffer.concat([writeVarInt(bytes.length), bytes])

const isP2pkhScript = (script: Uint8Array) =>
  script.length === 25 &&
  script[0] === 0x76 &&
  script[1] === 0xa9 &&
  script[2] === 0x14 &&
  script[23] === 0x88 &&
  script[24] === 0xac

const toOpReturnScript = (memo: Uint8Array) => {
  if (memo.length > MAX_OP_RETURN_LENGTH) {
    throw new Error(`Zcash v5: OP_RETURN memo is ${memo.length} bytes, max is ${MAX_OP_RETURN_LENGTH}`)
  }
  const push = memo.length < OP_PUSHDATA1 ? [memo.length] : [OP_PUSHDATA1, memo.length]
  return Buffer.concat([Buffer.from([OP_RETURN, ...push]), memo])
}

const buildZcashV5Tx = (walletCore: WalletCore, txInputData: Uint8Array): ZcashV5Tx => {
  const input = TW.Bitcoin.Proto.SigningInput.decode(txInputData)
  const plan = TW.Bitcoin.Proto.TransactionPlan.create(shouldBePresent(input.plan, 'Zcash v5: transaction plan'))

  if (plan.branchId.length !== BRANCH_ID_LENGTH) {
    throw new Error(`Zcash v5: branch id must be ${BRANCH_ID_LENGTH} bytes, got ${plan.branchId.length}`)
  }

  if (plan.utxos.length === 0) {
    throw new Error('Zcash v5: transaction plan has no inputs')
  }

  const inputs = plan.utxos.map(planned => {
    const { amount, script, outPoint } = TW.Bitcoin.Proto.UnspentTransaction.create(planned)
    const { hash, index, sequence } = TW.Bitcoin.Proto.OutPoint.create(
      shouldBePresent(outPoint, 'Zcash v5: utxo outpoint')
    )
    if (!isP2pkhScript(script)) {
      throw new Error('Zcash v5: only transparent P2PKH inputs are supported')
    }
    return {
      prevout: Buffer.concat([hash, writeUInt32LE(index)]),
      amount: BigInt(amount.toString()),
      script: Buffer.from(script),
      sequence,
    }
  })

  const lockScript = (address: string) => {
    const script = walletCore.BitcoinScript.lockScriptForAddress(address, walletCore.CoinType.zcash).data()
    if (script.length === 0) {
      throw new Error(`Zcash v5: output address ${address} has no lock script`)
    }
    return Buffer.from(script)
  }

  const change = BigInt(plan.change.toString())
  const outputs: ZcashV5Output[] = [
    { amount: BigInt(plan.amount.toString()), script: lockScript(input.toAddress) },
    ...(change > 0n ? [{ amount: change, script: lockScript(input.changeAddress) }] : []),
    ...(plan.outputOpReturn.length > 0 ? [{ amount: 0n, script: toOpReturnScript(plan.outputOpReturn) }] : []),
  ]

  return {
    branchIdLE: Buffer.from(plan.branchId),
    lockTime: input.lockTime,
    inputs,
    outputs,
  }
}

const serializeHeader = (tx: ZcashV5Tx) =>
  Buffer.concat([
    writeUInt32LE(V5_HEADER),
    writeUInt32LE(V5_VERSION_GROUP_ID),
    tx.branchIdLE,
    writeUInt32LE(tx.lockTime),
    writeUInt32LE(NO_EXPIRY_HEIGHT),
  ])

const serializeOutputs = (outputs: ZcashV5Output[]) =>
  Buffer.concat(outputs.flatMap(({ amount, script }) => [writeUInt64LE(amount), lengthPrefixed(script)]))

const getDigests = (walletCore: WalletCore, tx: ZcashV5Tx) => {
  const hash = (personal: string, data: Uint8Array = new Uint8Array()) =>
    walletCore.Hash.blake2bPersonal(data, Buffer.from(personal), BLAKE2B_256_LENGTH)

  const header = hash('ZTxIdHeadersHash', serializeHeader(tx))
  const prevouts = hash('ZTxIdPrevoutHash', Buffer.concat(tx.inputs.map(({ prevout }) => prevout)))
  const sequences = hash('ZTxIdSequencHash', Buffer.concat(tx.inputs.map(({ sequence }) => writeUInt32LE(sequence))))
  const outputs = hash('ZTxIdOutputsHash', serializeOutputs(tx.outputs))
  const shieldedTail = Buffer.concat([hash('ZTxIdSaplingHash'), hash('ZTxIdOrchardHash')])
  const txHash = (transparent: Uint8Array) =>
    walletCore.Hash.blake2bPersonal(
      Buffer.concat([header, transparent, shieldedTail]),
      Buffer.concat([Buffer.from('ZcashTxHash_'), tx.branchIdLE]),
      BLAKE2B_256_LENGTH
    )

  const amounts = hash('ZTxTrAmountsHash', Buffer.concat(tx.inputs.map(({ amount }) => writeUInt64LE(amount))))
  const scripts = hash('ZTxTrScriptsHash', Buffer.concat(tx.inputs.map(({ script }) => lengthPrefixed(script))))

  const sighash = ({ prevout, amount, script, sequence }: ZcashV5Input) => {
    const txIn = hash(
      'Zcash___TxInHash',
      Buffer.concat([prevout, writeUInt64LE(amount), lengthPrefixed(script), writeUInt32LE(sequence)])
    )
    return txHash(
      hash(
        'ZTxIdTranspaHash',
        Buffer.concat([Buffer.from([SIGHASH_ALL]), prevouts, amounts, scripts, sequences, outputs, txIn])
      )
    )
  }

  const txId = () => txHash(hash('ZTxIdTranspaHash', Buffer.concat([prevouts, sequences, outputs])))

  return { sighash, txId }
}

const serializeZcashV5Tx = (tx: ZcashV5Tx, scriptSigs: Uint8Array[]) =>
  Buffer.concat([
    serializeHeader(tx),
    writeVarInt(tx.inputs.length),
    ...tx.inputs.flatMap(({ prevout, sequence }, index) => [
      prevout,
      lengthPrefixed(scriptSigs[index]),
      writeUInt32LE(sequence),
    ]),
    writeVarInt(tx.outputs.length),
    serializeOutputs(tx.outputs),
    // nSpendsSapling, nOutputsSapling, nActionsOrchard
    Buffer.from([0, 0, 0]),
  ])

type PreSigningHashesInput = {
  walletCore: WalletCore
  txInputData: Uint8Array
}

/** ZIP-244 SIGHASH_ALL digest per transparent input, in input order, for the planned Zcash SigningInput. */
export const getZcashV5PreSigningHashes = ({ walletCore, txInputData }: PreSigningHashesInput): Uint8Array[] => {
  const tx = buildZcashV5Tx(walletCore, txInputData)
  const { sighash } = getDigests(walletCore, tx)
  return tx.inputs.map(input => sighash(input))
}

type CompileInput = PreSigningHashesInput & {
  publicKey: PublicKey
  signatures: Record<string, KeysignSignature>
}

/**
 * Verifies each input's DER signature against its ZIP-244 sighash and returns an
 * encoded TW.Bitcoin.Proto.SigningOutput with the signed v5 bytes and the
 * ZIP-244 txid in display (byte-reversed) order.
 */
export const compileZcashV5Tx = ({ walletCore, txInputData, publicKey, signatures }: CompileInput): Uint8Array => {
  const tx = buildZcashV5Tx(walletCore, txInputData)
  const { sighash, txId } = getDigests(walletCore, tx)

  const scriptSigs = tx.inputs.map((input, index) => {
    const hash = sighash(input)
    const hashHex = Buffer.from(hash).toString('hex')
    const signature = generateSignature({
      walletCore,
      signature: shouldBePresent(signatures[hashHex], `Zcash v5: signature for input ${index} (${hashHex})`),
      signatureFormat: 'der',
    })
    assertSignature({ publicKey, message: hash, signature, signatureFormat: 'der' })
    return Buffer.concat([
      lengthPrefixed(Buffer.concat([signature, Buffer.from([SIGHASH_ALL])])),
      lengthPrefixed(publicKey.data()),
    ])
  })

  return TW.Bitcoin.Proto.SigningOutput.encode(
    TW.Bitcoin.Proto.SigningOutput.create({
      encoded: serializeZcashV5Tx(tx, scriptSigs),
      transactionId: Buffer.from(txId()).reverse().toString('hex'),
    })
  ).finish()
}
