import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
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

export const getSwapKitSignBitcoin = (keysignPayload: KeysignPayload): SignBitcoin | undefined => {
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
