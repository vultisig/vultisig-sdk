import { Buffer } from 'buffer'
import { toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { buildSignBitcoinFromPsbt } from '@vultisig/core-chain/chains/utxo/tx/buildSignBitcoinFromPsbt'
import { p2pkhScriptForAddress } from '@vultisig/core-chain/chains/utxo/tx/p2pkhScriptForAddress'
import { address as btcAddress, crypto, networks, Psbt } from 'bitcoinjs-lib'

import { KeysignPayload } from '../types/vultisig/keysign/v1/keysign_message_pb'
import { SwapKitSwapPayload } from '../types/vultisig/keysign/v1/swapkit_swap_payload_pb'
import { SignBitcoin, SignBitcoinSchema } from '../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'

type VerifySwapKitBitcoinPsbtOutputsInput = {
  signBitcoin: SignBitcoin
  chain?: string
  senderAddress: string
  expectedToAddress: string
  expectedToAmount: string | bigint
  amountMode?: 'exact' | 'maximum'
}

const getScriptPubKeyForAddress = (address: string, label: string, chain: string): Buffer => {
  if (!address) {
    throw new Error(`SwapKit Bitcoin PSBT ${label} address is empty.`)
  }

  try {
    if (chain === Chain.Dogecoin || chain === Chain.BitcoinCash || chain === Chain.Zcash) {
      return p2pkhScriptForAddress(chain, address)
    }
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

export const verifySwapKitBitcoinPsbtOutputs = ({
  signBitcoin,
  chain = Chain.Bitcoin,
  senderAddress,
  expectedToAddress,
  expectedToAmount,
  amountMode = 'exact',
}: VerifySwapKitBitcoinPsbtOutputsInput) => {
  const expectedDestinationScript = getScriptPubKeyForAddress(expectedToAddress, 'destination', chain)
  const expectedChangeScript = getScriptPubKeyForAddress(senderAddress, 'sender', chain)
  const expectedAmount = parseExpectedAmount(expectedToAmount)

  const outputs = signBitcoin.outputs.map((output, index) => ({
    output,
    script: getOutputScript(output.scriptPubKey, index),
  }))

  if (
    amountMode === 'maximum' &&
    (outputs.length < 1 ||
      outputs.length > 2 ||
      outputs.some(
        ({ script }) =>
          script.length !== 25 ||
          script.subarray(0, 3).toString('hex') !== '76a914' ||
          script.subarray(23).toString('hex') !== '88ac'
      ))
  ) {
    throw new Error('SwapKit legacy PSBT must have one deposit and optional change P2PKH output.')
  }

  outputs.forEach(({ output, script }, index) => {
    const derivedIsChange = script.equals(expectedChangeScript)
    if (output.isChange !== derivedIsChange) {
      throw new Error(
        `SwapKit Bitcoin PSBT output #${index} has isChange=${output.isChange}, ` +
          `but its scriptPubKey ${derivedIsChange ? 'does' : 'does not'} pay back to the sender.`
      )
    }
  })

  if (
    amountMode === 'maximum' &&
    outputs.length === 2 &&
    outputs.filter(({ output }) => output.isChange).length !== 1
  ) {
    throw new Error('SwapKit legacy PSBT second output must return change to the vault.')
  }

  const nonChangeOutputs = outputs.filter(({ output }) => !output.isChange)
  const nonChangeAmount = nonChangeOutputs.reduce((sum, { output }) => sum + output.amount, 0n)

  if (amountMode === 'exact' && nonChangeAmount !== expectedAmount) {
    throw new Error(
      `SwapKit Bitcoin PSBT non-change outputs sum to ${nonChangeAmount}, ` + `but expected ${expectedAmount}.`
    )
  }
  if (amountMode === 'maximum' && nonChangeAmount > expectedAmount) {
    throw new Error(`SwapKit PSBT deposit ${nonChangeAmount} exceeds quoted source amount ${expectedAmount}.`)
  }
  if (amountMode === 'maximum') {
    const totalIn = signBitcoin.inputs.reduce((sum, input) => sum + input.amount, 0n)
    const totalOut = signBitcoin.outputs.reduce((sum, output) => sum + output.amount, 0n)
    if (totalIn < totalOut || totalIn - totalOut > expectedAmount) {
      throw new Error('SwapKit PSBT miner fee is negative or exceeds the quoted source amount.')
    }
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
  if (amountMode === 'maximum' && nonChangeAmount <= 0n) {
    throw new Error('SwapKit legacy PSBT deposit amount must be positive.')
  }
}

const getSwapKitBitcoinPsbtPayload = (keysignPayload: KeysignPayload): SwapKitSwapPayload | undefined => {
  const chain = keysignPayload.coin?.chain
  if (keysignPayload.swapPayload.case !== 'swapkitSwapPayload') {
    return undefined
  }

  const swapKitPayload = keysignPayload.swapPayload.value
  const txType = swapKitPayload.txType.toUpperCase()
  if (chain === Chain.Bitcoin && txType === 'PSBT') return swapKitPayload
  if (chain === Chain.Dogecoin && (txType === 'PSBT' || txType === 'PSBT_DOGE')) return swapKitPayload
  if (chain === Chain.BitcoinCash && (txType === 'PSBT' || txType === 'PSBT_BCH')) return swapKitPayload
  return undefined
}

export const getSwapKitSignBitcoin = (keysignPayload: KeysignPayload): SignBitcoin | undefined => {
  let signBitcoin: SignBitcoin | undefined
  const swapKitBitcoinPsbtPayload = getSwapKitBitcoinPsbtPayload(keysignPayload)
  const chain = keysignPayload.coin?.chain

  if (
    (chain === Chain.Dogecoin || chain === Chain.BitcoinCash) &&
    keysignPayload.swapPayload.case === 'swapkitSwapPayload' &&
    keysignPayload.swapPayload.value.txPayload.length > 0 &&
    !swapKitBitcoinPsbtPayload
  ) {
    throw new Error(`Unsupported SwapKit ${chain} transaction type.`)
  }

  if (keysignPayload.signData.case === 'signBitcoin' && chain === Chain.Bitcoin) {
    signBitcoin = keysignPayload.signData.value
  } else if (swapKitBitcoinPsbtPayload) {
    const txPayload = swapKitBitcoinPsbtPayload.txPayload

    if (txPayload.length === 0) {
      throw new Error('SwapKit Bitcoin PSBT payload is empty.')
    }

    signBitcoin = buildSignBitcoinFromPsbt({
      psbt: Psbt.fromBuffer(Buffer.from(txPayload)),
      senderAddress: keysignPayload.coin?.address ?? '',
      ...(chain === Chain.Dogecoin || chain === Chain.BitcoinCash ? { chain } : {}),
    })
    if (
      keysignPayload.signData.case === 'signBitcoin' &&
      !Buffer.from(toBinary(SignBitcoinSchema, keysignPayload.signData.value)).equals(
        Buffer.from(toBinary(SignBitcoinSchema, signBitcoin))
      )
    ) {
      throw new Error('SwapKit PSBT signData does not match the provider transaction.')
    }
  }

  if (!signBitcoin) {
    return undefined
  }

  if (swapKitBitcoinPsbtPayload) {
    const legacy = chain === Chain.Dogecoin || chain === Chain.BitcoinCash
    if (
      legacy &&
      (swapKitBitcoinPsbtPayload.targetAddress !== keysignPayload.toAddress ||
        swapKitBitcoinPsbtPayload.fromCoin?.chain !== chain ||
        swapKitBitcoinPsbtPayload.fromCoin.address !== keysignPayload.coin?.address)
    ) {
      throw new Error('SwapKit PSBT chain, source, or destination disagrees with the keysign payload.')
    }
    verifySwapKitBitcoinPsbtOutputs({
      signBitcoin,
      chain,
      senderAddress: keysignPayload.coin?.address ?? '',
      expectedToAddress: legacy ? swapKitBitcoinPsbtPayload.targetAddress : keysignPayload.toAddress,
      expectedToAmount: legacy ? swapKitBitcoinPsbtPayload.fromAmount : keysignPayload.toAmount,
      amountMode: legacy ? 'maximum' : 'exact',
    })
  }

  return signBitcoin
}

/** Bind the payload's claimed vault address to the actual signing key before MPC. */
export const assertLegacySwapKitSigningKey = (signBitcoin: SignBitcoin, publicKey: Uint8Array): void => {
  const keyHash = Buffer.from(crypto.hash160(Buffer.from(publicKey)))
  if (signBitcoin.inputs.some(input => !Buffer.from(input.scriptPubKey, 'hex').subarray(3, 23).equals(keyHash))) {
    throw new Error('SwapKit PSBT input does not belong to the vault signing public key.')
  }
}
