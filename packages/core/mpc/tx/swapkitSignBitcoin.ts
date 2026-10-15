import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { getP2pkhScriptKeyHash, getPublicKeyHash160 } from '@vultisig/core-chain/chains/utxo/tx/p2pkhAddress'
import {
  buildSignBitcoinFromLegacyPsbt,
  SwapKitLegacyPsbtChain,
  swapKitLegacyPsbtChains,
  swapKitLegacyPsbtTxType,
} from '@vultisig/core-chain/chains/utxo/tx/swapKitLegacyPsbt'
import { verifySwapKitP2pkhSpend } from '@vultisig/core-chain/chains/utxo/tx/swapKitP2pkhSpend'
import { isOneOf } from '@vultisig/lib-utils/array/isOneOf'
import { shouldBePresent } from '@vultisig/lib-utils/assert/shouldBePresent'
import { address as btcAddress, networks, Psbt } from 'bitcoinjs-lib'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayload } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { SignBitcoin } from '../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

type VerifySwapKitBitcoinPsbtInputsInput = {
  signBitcoin: SignBitcoin
  senderAddress: string
}

type VerifySwapKitBitcoinPsbtOutputsInput = {
  signBitcoin: SignBitcoin
  senderAddress: string
  expectedToAddress: string
  expectedToAmount: string | bigint
}

const getScriptPubKeyForAddress = (address: string, label: string): Buffer => {
  if (!address) {
    throw new Error(`SwapKit Bitcoin PSBT ${label} address is empty.`)
  }

  try {
    return Buffer.from(btcAddress.toOutputScript(address, networks.bitcoin))
  } catch {
    throw new Error(`SwapKit Bitcoin PSBT ${label} address is invalid: ${address}`)
  }
}

const parseExpectedAmount = (amount: string | bigint): bigint => {
  if (typeof amount === 'string' && !/^\d+$/.test(amount)) {
    throw new Error(`SwapKit Bitcoin PSBT expected amount is invalid: ${amount}`)
  }

  try {
    const value = typeof amount === 'bigint' ? amount : BigInt(amount)
    if (value < 0n) {
      throw new Error('negative')
    }
    return value
  } catch {
    throw new Error(`SwapKit Bitcoin PSBT expected amount is invalid: ${amount}`)
  }
}

const parseScriptPubKey = (scriptPubKey: string, label: string): Buffer => {
  if (!/^(?:[0-9a-f]{2})+$/iu.test(scriptPubKey)) {
    throw new Error(`SwapKit Bitcoin PSBT ${label} has an invalid scriptPubKey.`)
  }

  return Buffer.from(scriptPubKey, 'hex')
}

const getOutputScript = (scriptPubKey: string, index: number): Buffer =>
  parseScriptPubKey(scriptPubKey, `output #${index}`)

/**
 * Refuses a SwapKit PSBT carrying an input this vault cannot sign.
 *
 * A SwapKit swap funds a deposit address from the vault's own UTXOs, so every
 * input is expected to be signable here. `compileSignBitcoinTx` gives an input
 * marked `isOurs === false` an empty witness and still returns a
 * complete-looking transaction, which this route broadcasts and the network
 * then rejects — after the signing ceremony has run and the user has approved.
 *
 * `isOurs` alone does not close that gap. `buildSignBitcoinFromPsbt` derives it
 * from BIP-32 derivation data, and falls back to marking *every* input ours
 * when no input carries any — so a PSBT with no derivation data at all presents
 * a foreign input as signable, and it is signed with this vault's key against a
 * script that key does not unlock. The address comparison below is the
 * unforgeable signal, exactly as output change detection prefers it over the
 * `isChange` flag: Vultisig holds a single address per UTXO chain, so every
 * input of a well-formed route pays to that one script.
 *
 * Deliberately not applied to the dApp `signPsbt` route, whose PSBTs may
 * legitimately include inputs owned by someone else and are returned partially
 * signed rather than broadcast.
 */
export const verifySwapKitBitcoinPsbtInputs = ({ signBitcoin, senderAddress }: VerifySwapKitBitcoinPsbtInputsInput) => {
  const expectedScript = getScriptPubKeyForAddress(senderAddress, 'sender')

  signBitcoin.inputs.forEach((input, index) => {
    if (!parseScriptPubKey(input.scriptPubKey, `input #${index}`).equals(expectedScript)) {
      throw new Error(
        `SwapKit Bitcoin PSBT input #${index} does not pay to this vault's address ${senderAddress}, ` +
          `so this vault cannot sign it.`
      )
    }

    if (!input.isOurs) {
      throw new Error(
        `SwapKit Bitcoin PSBT input #${index} pays to this vault's address but is not marked as ours, ` +
          `so it would be left unsigned.`
      )
    }
  })
}

export const verifySwapKitBitcoinPsbtOutputs = ({
  signBitcoin,
  senderAddress,
  expectedToAddress,
  expectedToAmount,
}: VerifySwapKitBitcoinPsbtOutputsInput) => {
  const expectedDestinationScript = getScriptPubKeyForAddress(expectedToAddress, 'destination')
  const expectedChangeScript = getScriptPubKeyForAddress(senderAddress, 'sender')
  const expectedAmount = parseExpectedAmount(expectedToAmount)

  const outputs = signBitcoin.outputs.map((output, index) => ({
    output,
    script: getOutputScript(output.scriptPubKey, index),
  }))

  outputs.forEach(({ output, script }, index) => {
    const derivedIsChange = script.equals(expectedChangeScript)
    if (output.isChange !== derivedIsChange) {
      throw new Error(
        `SwapKit Bitcoin PSBT output #${index} has isChange=${output.isChange}, ` +
          `but its scriptPubKey ${derivedIsChange ? 'does' : 'does not'} pay back to the sender.`
      )
    }
  })

  const nonChangeOutputs = outputs.filter(({ output }) => !output.isChange)
  const nonChangeAmount = nonChangeOutputs.reduce((sum, { output }) => sum + output.amount, 0n)

  if (nonChangeAmount !== expectedAmount) {
    throw new Error(
      `SwapKit Bitcoin PSBT non-change outputs sum to ${nonChangeAmount}, ` + `but expected ${expectedAmount}.`
    )
  }

  const destinationMatches = nonChangeOutputs.map(({ output, script }) => ({
    amount: output.amount,
    matches: script.equals(expectedDestinationScript),
  }))

  if (destinationMatches.some(({ amount, matches }) => amount > 0n && !matches)) {
    throw new Error(
      'SwapKit Bitcoin PSBT contains a value-bearing non-change output that is not the quoted destination.'
    )
  }

  const destinationMatchCount = destinationMatches.filter(({ matches }) => matches).length
  if (destinationMatchCount !== 1) {
    throw new Error(
      `SwapKit Bitcoin PSBT must contain exactly one non-change output paying to ${expectedToAddress}, ` +
        `but found ${destinationMatchCount}.`
    )
  }
}

const getSwapKitBitcoinPsbtPayload = (keysignPayload: KeysignPayload): SwapKitSwapPayload | undefined => {
  if (keysignPayload.coin?.chain !== Chain.Bitcoin || keysignPayload.swapPayload.case !== 'swapkitSwapPayload') {
    return undefined
  }

  const swapKitPayload = keysignPayload.swapPayload.value
  return swapKitPayload.txType.toUpperCase() === 'PSBT' ? swapKitPayload : undefined
}

type SwapKitLegacyPsbtKeysign = {
  chain: SwapKitLegacyPsbtChain
  swapKitPayload: SwapKitSwapPayload
}

/**
 * The SwapKit payload of a DOGE / BCH / DASH keysign that carries SwapKit's
 * pre-built PSBT (sdk#2460), or `undefined` for any other keysign. The
 * `txType` may be the wire value, blank, or the per-chain literal iOS and
 * Android stamp; anything else is refused rather than signed as something it
 * is not. A SwapKit payload with no transaction bytes is the plain deposit
 * transfer older SDK initiators produced and still signs through the regular
 * UTXO path.
 */
export const getSwapKitLegacyPsbtPayload = (keysignPayload: KeysignPayload): SwapKitLegacyPsbtKeysign | undefined => {
  const chain = keysignPayload.coin?.chain
  if (!isOneOf(chain, swapKitLegacyPsbtChains) || keysignPayload.swapPayload.case !== 'swapkitSwapPayload') {
    return undefined
  }

  const swapKitPayload = keysignPayload.swapPayload.value
  const txType = swapKitPayload.txType.trim().toUpperCase()
  if (swapKitPayload.txPayload.length === 0 && txType === '') {
    return undefined
  }
  if (!['', 'PSBT', swapKitLegacyPsbtTxType[chain]].includes(txType)) {
    throw new Error(`Unsupported SwapKit ${chain} transaction type "${swapKitPayload.txType}".`)
  }

  return { chain, swapKitPayload }
}

/**
 * SwapKit's DOGE / BCH / DASH PSBT as structured `SignBitcoin`, bound to the
 * keysign's vault address and quoted amount, or `undefined` when the keysign
 * carries no such PSBT. The hashes every co-signer must agree on come from
 * these PSBT bytes — never from the keysign's `signData` or a rebuilt
 * transfer — because that is what iOS and Android sign.
 */
export const getSwapKitLegacyPsbtSignBitcoin = (keysignPayload: KeysignPayload): SignBitcoin | undefined => {
  const legacyPsbt = getSwapKitLegacyPsbtPayload(keysignPayload)
  if (!legacyPsbt) {
    return undefined
  }

  const { chain, swapKitPayload } = legacyPsbt
  const signBitcoin = buildSignBitcoinFromLegacyPsbt({
    chain,
    psbt: swapKitPayload.txPayload,
    senderAddress: shouldBePresent(keysignPayload.coin, 'keysign coin').address,
  })
  verifySwapKitP2pkhSpend({
    chain,
    inputAmounts: signBitcoin.inputs.map(({ amount }) => amount),
    outputs: signBitcoin.outputs.map(({ amount, isChange }) => ({ amount, isChange })),
    fromAmount: swapKitPayload.fromAmount,
  })

  return signBitcoin
}

type AssertSignBitcoinInputsOwnedByKeyInput = {
  signBitcoin: SignBitcoin
  /** This vault's compressed secp256k1 public key for the keysign chain. */
  publicKey: Uint8Array
}

/**
 * Refuses a legacy PSBT whose P2PKH inputs lock to a key other than this
 * vault's own signing key. The keysign's coin address comes from the
 * initiator, so binding to it alone would still let the MPC network be asked
 * to sign an input the vault does not own.
 */
export const assertSignBitcoinInputsOwnedByKey = ({
  signBitcoin,
  publicKey,
}: AssertSignBitcoinInputsOwnedByKeyInput) => {
  const keyHash = getPublicKeyHash160(publicKey)
  signBitcoin.inputs.forEach((input, index) => {
    const inputKeyHash = getP2pkhScriptKeyHash(Buffer.from(input.scriptPubKey, 'hex'))
    if (!inputKeyHash?.equals(keyHash)) {
      throw new Error(`SwapKit PSBT input #${index} does not lock to this vault's signing key.`)
    }
  })
}

/**
 * The structured Bitcoin-family transaction a keysign signs through the
 * `SignBitcoin` hash and compile path, or `undefined` when the keysign is a
 * regular WalletCore-built transaction: a dApp PSBT (`signData.signBitcoin`),
 * SwapKit's Bitcoin PSBT, or SwapKit's DOGE / BCH / DASH PSBT.
 */
export const getSwapKitSignBitcoin = (keysignPayload: KeysignPayload): SignBitcoin | undefined => {
  const legacyPsbtSignBitcoin = getSwapKitLegacyPsbtSignBitcoin(keysignPayload)
  if (legacyPsbtSignBitcoin) {
    return legacyPsbtSignBitcoin
  }

  let signBitcoin: SignBitcoin | undefined
  const swapKitBitcoinPsbtPayload = getSwapKitBitcoinPsbtPayload(keysignPayload)

  if (keysignPayload.signData.case === 'signBitcoin') {
    signBitcoin = keysignPayload.signData.value
  } else if (swapKitBitcoinPsbtPayload) {
    const txPayload = swapKitBitcoinPsbtPayload.txPayload

    if (txPayload.length === 0) {
      throw new Error('SwapKit Bitcoin PSBT payload is empty.')
    }

    signBitcoin = buildSignBitcoinFromPsbt({
      psbt: Psbt.fromBuffer(Buffer.from(txPayload)),
      senderAddress: keysignPayload.coin?.address ?? '',
    })
  }

  if (!signBitcoin) {
    return undefined
  }

  if (swapKitBitcoinPsbtPayload) {
    verifySwapKitBitcoinPsbtInputs({
      signBitcoin,
      senderAddress: keysignPayload.coin?.address ?? '',
    })
    verifySwapKitBitcoinPsbtOutputs({
      signBitcoin,
      senderAddress: keysignPayload.coin?.address ?? '',
      expectedToAddress: keysignPayload.toAddress,
      expectedToAmount: keysignPayload.toAmount,
    })
  }

  return signBitcoin
}
