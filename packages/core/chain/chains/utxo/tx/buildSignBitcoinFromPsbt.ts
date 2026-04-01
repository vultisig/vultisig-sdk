import { create } from '@bufbuild/protobuf'
import {
  BitcoinInputSchema,
  BitcoinOutputSchema,
  SignBitcoin,
  SignBitcoinSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import {
  address as btcAddress,
  networks,
  opcodes,
  Psbt,
  script as bscript,
  Transaction,
} from 'bitcoinjs-lib'

/** Detect the script type from a scriptPubKey buffer. */
const detectScriptType = (scriptPubKey: Buffer): string => {
  if (scriptPubKey.length === 22 && scriptPubKey[0] === 0x00 && scriptPubKey[1] === 0x14) {
    return 'p2wpkh'
  }
  if (scriptPubKey.length === 25 && scriptPubKey[0] === 0x76) {
    return 'p2pkh'
  }
  if (scriptPubKey.length === 34 && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20) {
    return 'p2tr'
  }
  if (scriptPubKey.length === 23 && scriptPubKey[0] === 0xa9) {
    return 'p2sh-p2wpkh'
  }
  return 'unknown'
}

const isOpReturn = (script: Buffer): boolean => {
  const chunks = bscript.decompile(script)
  return chunks?.[0] === opcodes.OP_RETURN
}

const getOpReturnHex = (script: Buffer): string | undefined => {
  const chunks = bscript.decompile(script)
  if (!chunks || chunks[0] !== opcodes.OP_RETURN) return undefined
  const dataChunks = chunks
    .slice(1)
    .filter((chunk): chunk is Buffer => Buffer.isBuffer(chunk))
  if (dataChunks.length === 0) return undefined
  return Buffer.concat(dataChunks).toString('hex')
}

type BuildSignBitcoinFromPsbtInput = {
  psbt: Psbt
  senderAddress: string
}

/**
 * Decompose a BIP-174 PSBT into a structured SignBitcoin proto message.
 * Co-signing devices can verify every input/output and compute exact sighashes
 * from these fields without receiving an opaque blob.
 */
export const buildSignBitcoinFromPsbt = ({
  psbt,
  senderAddress,
}: BuildSignBitcoinFromPsbtInput): SignBitcoin => {
  const network = networks.bitcoin

  const inputs = psbt.txInputs.map((txInput, i) => {
    const inputData = psbt.data.inputs[i]

    // Prefer witnessUtxo; fall back to nonWitnessUtxo (full prev tx)
    let scriptPubKey: Buffer
    let inputValue: bigint
    if (inputData.witnessUtxo) {
      scriptPubKey = Buffer.from(inputData.witnessUtxo.script)
      inputValue = BigInt(inputData.witnessUtxo.value)
    } else if (inputData.nonWitnessUtxo) {
      const prevTx = Transaction.fromBuffer(
        Buffer.from(inputData.nonWitnessUtxo)
      )
      const prevOutput = prevTx.outs[txInput.index]
      if (!prevOutput) {
        throw new Error(
          `Input #${i}: nonWitnessUtxo has no output at index ${txInput.index}`
        )
      }
      scriptPubKey = Buffer.from(prevOutput.script)
      inputValue = BigInt(prevOutput.value)
    } else {
      throw new Error(
        `Input #${i} missing both witnessUtxo and nonWitnessUtxo`
      )
    }

    const scriptType = detectScriptType(scriptPubKey)

    // If any input has BIP32 derivation, use it to determine ownership.
    // Otherwise (e.g. simple PSBTs without derivation paths), assume all inputs are ours.
    const hasBip32 =
      (inputData.bip32Derivation && inputData.bip32Derivation.length > 0) ||
      ((inputData as any).tapBip32Derivation &&
        (inputData as any).tapBip32Derivation.length > 0)
    const anyInputHasBip32 = psbt.data.inputs.some(
      inp =>
        (inp.bip32Derivation && inp.bip32Derivation.length > 0) ||
        ((inp as any).tapBip32Derivation &&
          (inp as any).tapBip32Derivation.length > 0)
    )

    const sighashType =
      typeof (inputData as any).sighashType === 'number'
        ? (inputData as any).sighashType
        : 1 // SIGHASH_ALL

    const redeemScript = inputData.redeemScript
      ? Buffer.from(inputData.redeemScript).toString('hex')
      : undefined

    return create(BitcoinInputSchema, {
      hash: Buffer.from(txInput.hash).reverse().toString('hex'),
      index: txInput.index,
      amount: inputValue,
      scriptPubKey: scriptPubKey.toString('hex'),
      scriptType,
      sighashType,
      isOurs: anyInputHasBip32 ? !!hasBip32 : true,
      redeemScript,
      sequence: txInput.sequence,
    })
  })

  const outputs = psbt.txOutputs.map(txOutput => {
    const script = Buffer.from(txOutput.script)
    const opReturn = isOpReturn(script)

    let outputAddress = ''
    if (!opReturn) {
      try {
        outputAddress = btcAddress.fromOutputScript(txOutput.script, network)
      } catch {
        // Non-standard output — address stays empty
      }
    }

    return create(BitcoinOutputSchema, {
      amount: BigInt(txOutput.value),
      address: outputAddress,
      opReturnData: opReturn ? getOpReturnHex(script) : undefined,
      scriptPubKey: script.toString('hex'),
      isChange: outputAddress === senderAddress,
    })
  })

  return create(SignBitcoinSchema, {
    version: psbt.version,
    locktime: psbt.locktime,
    inputs,
    outputs,
  })
}
