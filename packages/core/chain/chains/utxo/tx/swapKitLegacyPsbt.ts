import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import {
  BitcoinInputSchema,
  BitcoinOutputSchema,
  SignBitcoin,
  SignBitcoinSchema,
} from '@vultisig/mpc-types/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { Psbt, Transaction } from 'bitcoinjs-lib'
import { Buffer } from 'buffer'

import { encodeP2pkhAddress, getP2pkhScriptForAddress, getP2pkhScriptKeyHash } from './p2pkhAddress'

/**
 * UTXO chains whose SwapKit swap is a pre-built PSBT over legacy P2PKH inputs
 * (no segwit): DOGE and DASH sign with the original pre-BIP143 sighash, BCH
 * with its BIP143-style digest under SIGHASH_FORKID. Mirrors iOS
 * `SwapKitLegacyP2PKHSigner` and Android `SwapKitLegacyP2PKHSigner`.
 */
export const swapKitLegacyPsbtChains = [Chain.Dogecoin, Chain.BitcoinCash, Chain.Dash] as const

export type SwapKitLegacyPsbtChain = (typeof swapKitLegacyPsbtChains)[number]

export const isSwapKitLegacyPsbtChain = (chain: Chain): chain is SwapKitLegacyPsbtChain =>
  isOneOf(chain, swapKitLegacyPsbtChains)

/** The `SwapKitSwapPayload.txType` iOS and Android stamp on each chain's PSBT; iOS dispatches on it verbatim. */
export const swapKitLegacyPsbtTxType: Record<SwapKitLegacyPsbtChain, string> = {
  [Chain.Dogecoin]: 'PSBT_DOGE',
  [Chain.BitcoinCash]: 'PSBT_BCH',
  [Chain.Dash]: 'PSBT_DASH',
}

/** SIGHASH_ALL, with SIGHASH_FORKID (0x40) on Bitcoin Cash. */
export const swapKitLegacyPsbtSighashType: Record<SwapKitLegacyPsbtChain, number> = {
  [Chain.Dogecoin]: 0x01,
  [Chain.BitcoinCash]: 0x41,
  [Chain.Dash]: 0x01,
}

/**
 * Transaction versions the direct sighash path reproduces. SwapKit ships
 * version 1 and, lately, version 2; anything else is more likely a wire
 * change than a legitimate new value, so it is refused rather than guessed.
 */
const supportedTxVersions = [1, 2]

const parseLegacyPsbt = (chain: Chain, psbtBytes: Uint8Array): Psbt => {
  if (psbtBytes.length === 0) {
    throw new Error(`SwapKit ${chain} PSBT payload is empty.`)
  }
  try {
    return Psbt.fromBuffer(Buffer.from(psbtBytes))
  } catch (error) {
    throw new Error(`SwapKit ${chain} PSBT is malformed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

type Prevout = {
  amount: bigint
  script: Buffer
}

/**
 * The previous output an input spends. The full previous transaction
 * (`NON_WITNESS_UTXO`) is authenticated by hashing it against the outpoint.
 * A bare `WITNESS_UTXO` is only acceptable on Bitcoin Cash, whose fork-id
 * digest commits the amount so a lie merely invalidates the signature; the
 * pre-BIP143 sighash DOGE and DASH use does not, so an understated amount
 * there would pass the fee bound while the real surplus went to the miner.
 */
const resolvePrevout = (chain: SwapKitLegacyPsbtChain, psbt: Psbt, index: number): Prevout => {
  const txInput = psbt.txInputs[index]
  const inputData = psbt.data.inputs[index]
  const witnessPrevout = inputData.witnessUtxo
    ? { amount: BigInt(inputData.witnessUtxo.value), script: Buffer.from(inputData.witnessUtxo.script) }
    : undefined

  if (!inputData.nonWitnessUtxo) {
    if (witnessPrevout && chain === Chain.BitcoinCash) {
      return witnessPrevout
    }
    throw new Error(
      witnessPrevout
        ? `SwapKit ${chain} PSBT input #${index} carries only a WITNESS_UTXO; ${chain} sighashes do not commit to input amounts, so the full previous transaction is required.`
        : `SwapKit ${chain} PSBT input #${index} is missing its previous transaction.`
    )
  }

  const prevTx = Transaction.fromBuffer(Buffer.from(inputData.nonWitnessUtxo))
  const expectedTxId = Buffer.from(txInput.hash).reverse().toString('hex')
  if (prevTx.getId() !== expectedTxId) {
    throw new Error(`SwapKit ${chain} PSBT input #${index} previous transaction does not hash to its outpoint.`)
  }
  const prevOutput = prevTx.outs[txInput.index]
  if (!prevOutput) {
    throw new Error(
      `SwapKit ${chain} PSBT input #${index} spends output ${txInput.index}, which its previous transaction lacks.`
    )
  }
  const prevout = { amount: BigInt(prevOutput.value), script: Buffer.from(prevOutput.script) }

  if (witnessPrevout && (witnessPrevout.amount !== prevout.amount || !witnessPrevout.script.equals(prevout.script))) {
    throw new Error(`SwapKit ${chain} PSBT input #${index} WITNESS_UTXO disagrees with its previous transaction.`)
  }

  return prevout
}

type BuildSignBitcoinFromLegacyPsbtInput = {
  chain: SwapKitLegacyPsbtChain
  psbt: Uint8Array
  /** The vault's own address on `chain`; every input must spend from it. */
  senderAddress: string
}

/**
 * Decomposes a SwapKit DOGE / BCH / DASH PSBT into the structured
 * `SignBitcoin` the legacy sighash and compile paths consume, keeping the
 * PSBT's version, locktime, inputs and outputs exactly. Refuses anything that
 * is not an unsigned spend of the vault's own P2PKH script into P2PKH outputs,
 * so a hash is never produced for an input this vault does not own. Amounts
 * are bound separately by `verifySwapKitP2pkhSpend`.
 */
export const buildSignBitcoinFromLegacyPsbt = ({
  chain,
  psbt: psbtBytes,
  senderAddress,
}: BuildSignBitcoinFromLegacyPsbtInput): SignBitcoin => {
  const psbt = parseLegacyPsbt(chain, psbtBytes)

  if (!supportedTxVersions.includes(psbt.version)) {
    throw new Error(`SwapKit ${chain} PSBT transaction version ${psbt.version} is unsupported.`)
  }
  if (psbt.txInputs.length === 0 || psbt.txOutputs.length === 0) {
    throw new Error(`SwapKit ${chain} PSBT has no inputs or no outputs.`)
  }

  const senderScript = getP2pkhScriptForAddress({ chain, address: senderAddress })
  const expectedSighashType = swapKitLegacyPsbtSighashType[chain]

  const inputs = psbt.txInputs.map((txInput, index) => {
    const inputData = psbt.data.inputs[index]
    if (
      inputData.partialSig?.length ||
      inputData.finalScriptSig ||
      inputData.finalScriptWitness ||
      inputData.redeemScript ||
      inputData.witnessScript
    ) {
      throw new Error(`SwapKit ${chain} PSBT input #${index} is not an unsigned P2PKH input.`)
    }

    const { amount, script } = resolvePrevout(chain, psbt, index)
    if (!script.equals(senderScript)) {
      throw new Error(
        `SwapKit ${chain} PSBT input #${index} does not spend from this vault's address ${senderAddress}.`
      )
    }

    const sighashType = inputData.sighashType ?? expectedSighashType
    if (sighashType !== expectedSighashType) {
      throw new Error(
        `SwapKit ${chain} PSBT input #${index} requests sighash type 0x${sighashType.toString(16)}; only 0x${expectedSighashType.toString(16)} is supported.`
      )
    }

    return create(BitcoinInputSchema, {
      hash: Buffer.from(txInput.hash).reverse().toString('hex'),
      index: txInput.index,
      amount,
      scriptPubKey: script.toString('hex'),
      scriptType: 'p2pkh',
      sighashType,
      isOurs: true,
      sequence: txInput.sequence,
    })
  })

  const outputs = psbt.txOutputs.map((txOutput, index) => {
    const script = Buffer.from(txOutput.script)
    const keyHash = getP2pkhScriptKeyHash(script)
    if (!keyHash) {
      throw new Error(`SwapKit ${chain} PSBT output #${index} is not a P2PKH output: ${script.toString('hex')}`)
    }

    return create(BitcoinOutputSchema, {
      amount: BigInt(txOutput.value),
      address: encodeP2pkhAddress({ chain, keyHash }),
      scriptPubKey: script.toString('hex'),
      isChange: script.equals(senderScript),
    })
  })

  return create(SignBitcoinSchema, {
    version: psbt.version,
    locktime: psbt.locktime,
    inputs,
    outputs,
  })
}

const bip68DisableFlagBit = 31

/**
 * Rewrites a version-2 SwapKit PSBT to version 1 before it is sent to
 * co-signers, as the Android initiator does. Every co-signer must hash the
 * same transaction: Android signs these chains through WalletCore, which only
 * emits version 1, while iOS and this SDK keep the PSBT's own version — so the
 * initiator settles on version 1 for everyone. Version 2 differs from 1 only
 * by enabling BIP68 relative locktimes, so the rewrite is refused when any
 * input's sequence has that flag clear. A version-1 PSBT is returned as is.
 */
export const normalizeSwapKitLegacyPsbtVersion = (chain: SwapKitLegacyPsbtChain, psbtBytes: Uint8Array): Uint8Array => {
  const psbt = parseLegacyPsbt(chain, psbtBytes)
  if (psbt.version === 1) {
    return psbtBytes
  }
  if (psbt.version !== 2) {
    throw new Error(`SwapKit ${chain} PSBT transaction version ${psbt.version} is unsupported.`)
  }

  psbt.txInputs.forEach(({ sequence }, index) => {
    const bip68Disabled = (sequence ?? 0xffffffff) >>> bip68DisableFlagBit === 1
    if (!bip68Disabled) {
      throw new Error(
        `SwapKit ${chain} PSBT input #${index} enables a BIP68 relative locktime, which a version-1 transaction cannot carry.`
      )
    }
  })

  psbt.setVersion(1)
  return psbt.toBuffer()
}
