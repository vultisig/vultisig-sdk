import { create } from '@bufbuild/protobuf'
import {
  BitcoinInputSchema,
  BitcoinOutputSchema,
  SignBitcoin,
  SignBitcoinSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import {
  address as btcAddress,
  Network,
  networks,
  opcodes,
  Psbt,
  script as bscript,
  Transaction,
} from 'bitcoinjs-lib'

/** Supported script types for PSBT decomposition. */
type ScriptType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr' | 'p2wsh' | 'unknown'

/**
 * Detect the script type from a scriptPubKey buffer.
 * See https://github.com/bitcoin/bips/blob/master/bip-0141.mediawiki
 */
const detectScriptType = (
  scriptPubKey: Buffer,
  redeemScript?: Uint8Array
): ScriptType => {
  // P2WPKH: OP_0 PUSH_20 <20-byte-hash> (22 bytes)
  if (scriptPubKey.length === 22 && scriptPubKey[0] === 0x00 && scriptPubKey[1] === 0x14) {
    return 'p2wpkh'
  }
  // P2PKH: OP_DUP OP_HASH160 PUSH_20 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG (25 bytes)
  if (
    scriptPubKey.length === 25 &&
    scriptPubKey[0] === 0x76 &&
    scriptPubKey[1] === 0xa9 &&
    scriptPubKey[2] === 0x14 &&
    scriptPubKey[23] === 0x88 &&
    scriptPubKey[24] === 0xac
  ) {
    return 'p2pkh'
  }
  // P2TR: OP_1 PUSH_32 <32-byte-key> (34 bytes)
  if (scriptPubKey.length === 34 && scriptPubKey[0] === 0x51 && scriptPubKey[1] === 0x20) {
    return 'p2tr'
  }
  // P2WSH: OP_0 PUSH_32 <32-byte-hash> (34 bytes)
  if (scriptPubKey.length === 34 && scriptPubKey[0] === 0x00 && scriptPubKey[1] === 0x20) {
    return 'p2wsh'
  }
  // P2SH-P2WPKH: only when redeemScript is a valid P2WPKH witness program
  const redeem = redeemScript ? Buffer.from(redeemScript) : undefined
  if (
    scriptPubKey.length === 23 &&
    scriptPubKey[0] === 0xa9 &&
    scriptPubKey[1] === 0x14 &&
    scriptPubKey[22] === 0x87 &&
    redeem?.length === 22 &&
    redeem[0] === 0x00 &&
    redeem[1] === 0x14
  ) {
    return 'p2sh-p2wpkh'
  }
  return 'unknown'
}

/** Script types that computePreSigningHashes can produce sighashes for. */
const SUPPORTED_SCRIPT_TYPES: ReadonlySet<ScriptType> = new Set(['p2wpkh', 'p2sh-p2wpkh'])

const isOpReturn = (script: Buffer): boolean => {
  const chunks = bscript.decompile(script)
  return chunks !== null && chunks[0] === opcodes.OP_RETURN
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
  /** Bitcoin network for address decoding. Defaults to mainnet. */
  network?: Network
}

/**
 * Decompose a BIP-174 PSBT into a structured SignBitcoin proto message.
 * Co-signing devices can verify every input/output and compute exact sighashes
 * from these fields without receiving an opaque blob.
 *
 * Currently supports P2WPKH and P2SH-P2WPKH inputs only.
 * P2TR (Taproot/BIP-341) requires a different sighash algorithm and is planned for follow-up.
 * P2PKH (legacy) requires legacy sighash (not BIP-143).
 * See https://github.com/bitcoin/bips/blob/master/bip-0174.mediawiki
 */
export const buildSignBitcoinFromPsbt = ({
  psbt,
  senderAddress,
  network = networks.bitcoin,
}: BuildSignBitcoinFromPsbtInput): SignBitcoin => {
  // Compute anyInputHasBip32 once (not per-input) for O(n) ownership detection
  const anyInputHasBip32 = psbt.data.inputs.some(
    inp =>
      (inp.bip32Derivation && inp.bip32Derivation.length > 0) ||
      (inp.tapBip32Derivation &&
        inp.tapBip32Derivation.length > 0)
  )

  const inputs = psbt.txInputs.map((txInput, i) => {
    const inputData = psbt.data.inputs[i]

    // Prefer witnessUtxo; fall back to nonWitnessUtxo (full prev tx)
    let scriptPubKey: Buffer
    let inputValue: bigint
    if (inputData.witnessUtxo) {
      scriptPubKey = Buffer.from(inputData.witnessUtxo.script)
      inputValue = BigInt(inputData.witnessUtxo.value)

      // Fee snipe mitigation: cross-validate against nonWitnessUtxo if present.
      // A malicious PSBT can lie about witnessUtxo.value; BIP-143 commits to it
      // in the sighash, causing excess fees if the actual UTXO is worth more.
      // See https://blog.trezor.io/details-of-the-multisig-change-address-issue-and-its-mitigation-6370ad73ed2a
      if (inputData.nonWitnessUtxo) {
        const prevTx = Transaction.fromBuffer(
          Buffer.from(inputData.nonWitnessUtxo)
        )
        // BIP-174: verify nonWitnessUtxo txid matches the input's prevout hash
        const prevTxId = prevTx.getId()
        const expectedTxId = Buffer.from(txInput.hash).reverse().toString('hex')
        if (prevTxId !== expectedTxId) {
          throw new Error(
            `Input #${i}: nonWitnessUtxo txid (${prevTxId.slice(0, 16)}...) does not match ` +
              `input prevout (${expectedTxId.slice(0, 16)}...)`
          )
        }
        const prevOutput = prevTx.outs[txInput.index]
        if (prevOutput && BigInt(prevOutput.value) !== inputValue) {
          throw new Error(
            `Input #${i}: witnessUtxo value (${inputValue}) does not match ` +
              `nonWitnessUtxo value (${prevOutput.value}) - possible fee snipe`
          )
        }
      }
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

    if (inputValue < 0n) {
      throw new Error(`Input #${i}: negative amount (${inputValue})`)
    }

    const scriptType = detectScriptType(scriptPubKey, inputData.redeemScript)

    // Fail early for unsupported script types rather than at sighash time.
    // This gives a clearer error at decomposition time.
    const hasBip32 =
      (inputData.bip32Derivation && inputData.bip32Derivation.length > 0) ||
      (inputData.tapBip32Derivation &&
        inputData.tapBip32Derivation.length > 0)
    const isOurs = anyInputHasBip32 ? !!hasBip32 : true

    if (isOurs && !SUPPORTED_SCRIPT_TYPES.has(scriptType)) {
      const hints: Record<string, string> = {
        p2tr: 'P2TR (Taproot) requires BIP-341 sighash. See https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki',
        p2pkh: 'P2PKH (legacy) requires legacy sighash, not BIP-143.',
        p2wsh: 'P2WSH requires BIP-143 with the full witnessScript as scriptCode.',
        unknown: `Unrecognized scriptPubKey: ${scriptPubKey.toString('hex')}`,
      }
      throw new Error(
        `Input #${i}: unsupported script type '${scriptType}' for signing. ${hints[scriptType] ?? ''}`
      )
    }

    const sighashType = inputData.sighashType ?? 1 // SIGHASH_ALL

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
      isOurs,
      redeemScript,
      sequence: txInput.sequence,
    })
  })

  const outputs = psbt.txOutputs.map((txOutput, outputIndex) => {
    const script = Buffer.from(txOutput.script)
    const opReturn = isOpReturn(script)

    let outputAddress = ''
    if (!opReturn) {
      try {
        outputAddress = btcAddress.fromOutputScript(txOutput.script, network)
      } catch {
        // Non-standard output - address stays empty
      }
    }

    // Change detection: Vultisig uses a single address per UTXO chain (no HD change
    // derivation), so address comparison is the primary signal. BIP32 derivation on
    // outputs is NOT used alone because a malicious dApp could inject derivation paths
    // on attacker outputs to disguise them as change. Address match is unforgeable
    // since only the vault owner knows the private key for that address.
    return create(BitcoinOutputSchema, {
      amount: BigInt(txOutput.value),
      address: outputAddress,
      opReturnData: opReturn ? getOpReturnHex(script) : undefined,
      scriptPubKey: script.toString('hex'),
      isChange: outputAddress !== '' && outputAddress === senderAddress,
    })
  })

  return create(SignBitcoinSchema, {
    version: psbt.version,
    locktime: psbt.locktime,
    inputs,
    outputs,
  })
}
