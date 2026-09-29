import { Buffer } from 'buffer'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { address as btcAddress, networks, Psbt } from 'bitcoinjs-lib'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayload } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { SignBitcoin } from '../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

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

const getOutputScript = (scriptPubKey: string, index: number): Buffer => {
  if (!/^(?:[0-9a-f]{2})+$/iu.test(scriptPubKey)) {
    throw new Error(`SwapKit Bitcoin PSBT output #${index} has an invalid scriptPubKey.`)
  }

  return Buffer.from(scriptPubKey, 'hex')
}

/**
 * Refuses a SwapKit PSBT carrying an input this vault cannot sign.
 *
 * A SwapKit swap funds a deposit address from the vault's own UTXOs, so every
 * input is expected to be signable here. `compileSignBitcoinTx` gives an input
 * it cannot sign an empty witness and still returns a complete-looking
 * transaction, which this route broadcasts and the network then rejects — after
 * the signing ceremony has run and the user has approved. Refusing up front
 * turns that into an error the user sees before any of it happens.
 *
 * Deliberately not applied to the dApp `signPsbt` route, whose PSBTs may
 * legitimately include inputs owned by someone else and are returned partially
 * signed rather than broadcast.
 */
export const verifySwapKitBitcoinPsbtInputs = (signBitcoin: SignBitcoin) => {
  const unsignable = signBitcoin.inputs.map((input, index) => ({ input, index })).filter(({ input }) => !input.isOurs)

  if (unsignable.length > 0) {
    const indices = unsignable.map(({ index }) => `#${index}`).join(', ')
    throw new Error(
      `SwapKit Bitcoin PSBT must spend only this vault's own inputs, ` +
        `but input ${indices} cannot be signed by this vault.`
    )
  }
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
    verifySwapKitBitcoinPsbtInputs(signBitcoin)
    verifySwapKitBitcoinPsbtOutputs({
      signBitcoin,
      senderAddress: keysignPayload.coin?.address ?? '',
      expectedToAddress: keysignPayload.toAddress,
      expectedToAmount: keysignPayload.toAmount,
    })
  }

  return signBitcoin
}
