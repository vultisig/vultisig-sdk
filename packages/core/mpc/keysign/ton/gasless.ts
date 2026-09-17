import { Buffer } from 'buffer'
import { Address, Cell } from '@ton/core'
import { areEqualTonAddresses } from '@vultisig/core-chain/chains/ton/address'
import { validateTonComment } from '@vultisig/core-chain/chains/ton/comment'
import {
  attachTonGaslessSignature,
  buildTonGaslessExternalMessage,
  buildTonGaslessSigningCell,
} from '@vultisig/core-chain/chains/ton/gasless/request'
import {
  buildTonJettonTransferBody,
  parseTonJettonTransferBody,
  TonJettonTransferBody,
} from '@vultisig/core-chain/chains/ton/jetton/transferBody'
import { tonPayloadToBase64 } from '@vultisig/core-chain/chains/ton/messageBody/decode'
import { resolveTonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { buildTonV5R1StateInit } from '@vultisig/core-chain/chains/ton/walletV5R1'
import { signatureFormats } from '@vultisig/core-chain/signing/SignatureFormat'
import { assertSignature } from '@vultisig/core-chain/utils/assertSignature'
import { TW, WalletCore } from '@trustwallet/wallet-core'
import { PublicKey } from '@trustwallet/wallet-core/dist/src/wallet-core'

import { generateSignature } from '../../tx/signature/generateSignature'
import { TonGasless } from '../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { TonMessage } from '../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { getBlockchainSpecificValue } from '../chainSpecific/KeysignChainSpecific'
import { KeysignSignature } from '../KeysignSignature'
import { getKeysignTwPublicKey } from '../tw/getKeysignTwPublicKey'
import { getKeysignAmount } from '../utils/getKeysignAmount'
import { getKeysignCoin } from '../utils/getKeysignCoin'

/** The relay quote a TON keysign payload carries, or `undefined` for a direct send. */
export const getKeysignTonGasless = (keysignPayload: KeysignPayload): TonGasless | undefined =>
  keysignPayload.blockchainSpecific.case === 'tonSpecific' ? keysignPayload.blockchainSpecific.value.gasless : undefined

/**
 * The most TON the quoted messages may attach in total, 0.5 TON. The relay
 * funds what the wallet forwards, so this is not a fee the user pays — but a
 * wallet that also holds TON would pay any excess out of its own balance, and
 * the quote is a third party's input. A jetton transfer needs a few
 * hundredths of a TON, so the bound is generous without being a drain.
 */
export const tonGaslessMaxAttachedValue = 500_000_000n

/** The transfer and the commission; a third message is tolerated, a batch beyond that is not a transfer. */
const tonGaslessMaxMessages = 3

const decimalPattern = /^\d+$/

const parseDecimal = (field: string, value: string): bigint => {
  if (!decimalPattern.test(value)) {
    throw new Error(`Gasless TON ${field} is not a whole number: ${value}`)
  }

  return BigInt(value)
}

type BuildTonGaslessTransferBodyInput = {
  keysignPayload: KeysignPayload
  relayAddress: string
  isActiveDestination: boolean
}

/**
 * The jetton transfer the relay is asked to price, and the one the signer
 * expects to find in the quote. Unspent TON goes back to the relay rather than
 * the sender: it is the relay's TON to begin with, and returning it is what
 * keeps the commission low.
 */
export const buildTonGaslessTransferBody = ({
  keysignPayload,
  relayAddress,
  isActiveDestination,
}: BuildTonGaslessTransferBodyInput): Cell => {
  const amount = getKeysignAmount(keysignPayload)
  const comment = keysignPayload.memo ?? ''
  validateTonComment({
    memo: comment,
    jetton: { amount, isActiveDestination },
  })

  return buildTonJettonTransferBody({
    amount,
    destination: keysignPayload.toAddress,
    responseDestination: relayAddress,
    forwardTonAmount: isActiveDestination ? 1n : 0n,
    comment,
  })
}

const messagePayloadCell = (message: TonMessage): Cell => {
  const payload = tonPayloadToBase64(message.payload)
  if (!payload) {
    throw new Error('Gasless TON quote contains a message without a payload')
  }

  return Cell.fromBase64(payload)
}

/** What the approved transfer must look like, as the signer reads it off the payload. */
type TonGaslessTransferExpectation = {
  amount: bigint
  sender: Address
  relay: Address
  comment: string
}

/**
 * The transfer the relay echoed back must move the approved amount, refund
 * only to the relay or the sender, forward no more than a notification's worth
 * of TON, carry no custom payload, and keep the comment word for word.
 */
const assertTonGaslessTransferBody = (
  body: TonJettonTransferBody,
  { amount, sender, relay, comment }: TonGaslessTransferExpectation
): void => {
  if (body.amount !== amount) {
    throw new Error(`Gasless TON quote transfers ${body.amount} instead of the approved ${amount}`)
  }
  if (
    !body.responseDestination ||
    !(body.responseDestination.equals(relay) || body.responseDestination.equals(sender))
  ) {
    throw new Error('Gasless TON quote refunds the transfer somewhere other than the relay or the sender')
  }
  if (body.forwardTonAmount > 1n) {
    throw new Error('Gasless TON quote forwards more TON with the transfer than a notification needs')
  }
  if (body.hasCustomPayload) {
    throw new Error('Gasless TON quote attached a custom payload to the transfer')
  }
  if ((body.comment ?? '') !== comment || (body.hasForwardPayload && body.comment === null)) {
    throw new Error('Gasless TON quote changed the transfer comment')
  }
}

type TonGaslessQuotedTransfer = {
  body: TonJettonTransferBody
  /** Nanotons the message attaches. */
  value: bigint
}

/**
 * Reads one quoted message as a jetton transfer leaving through the sender's
 * jetton wallet, which is the only kind of message a gasless transfer may
 * carry: nothing that deploys code, nothing addressed elsewhere.
 */
const parseTonGaslessQuotedTransfer = (message: TonMessage, jettonAddress: string): TonGaslessQuotedTransfer => {
  if (message.stateInit) {
    throw new Error('Gasless TON quote asks the wallet to deploy a contract')
  }
  if (!areEqualTonAddresses(message.to, jettonAddress)) {
    throw new Error('Gasless TON quote sends a message somewhere other than the sender jetton wallet')
  }

  const body = parseTonJettonTransferBody(messagePayloadCell(message))
  if (!body) {
    throw new Error('Gasless TON quote contains a message that is not a jetton transfer')
  }

  return { body, value: parseDecimal('message value', message.amount) }
}

type TonGaslessQuoteSubject = {
  gasless: TonGasless
  /** The sender's jetton wallet, which every quoted message must leave through. */
  jettonAddress: string
}

/** The payload-level facts a quote is judged against, refusing a payload that cannot be a gasless send at all. */
const getTonGaslessQuoteSubject = (keysignPayload: KeysignPayload): TonGaslessQuoteSubject => {
  const gasless = getKeysignTonGasless(keysignPayload)
  if (!gasless) {
    throw new Error('Keysign payload carries no gasless quote')
  }

  const coin = getKeysignCoin(keysignPayload)
  if (!coin.id) {
    throw new Error('A gasless TON send must be a jetton transfer; native TON pays its fee in TON')
  }
  if (!areEqualTonAddresses(gasless.gasJettonMaster, coin.id)) {
    throw new Error('A gasless TON send pays its commission in the jetton being sent')
  }

  const { jettonAddress } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'tonSpecific')
  if (!jettonAddress.trim()) {
    throw new Error('A gasless TON send needs the sender jetton wallet address')
  }
  if (areEqualTonAddresses(keysignPayload.toAddress, gasless.relayAddress)) {
    throw new Error('A gasless TON send cannot be addressed to the relay itself')
  }
  if (gasless.messages.length === 0 || gasless.messages.length > tonGaslessMaxMessages) {
    throw new Error(
      `Gasless TON quote must hold 1 to ${tonGaslessMaxMessages} messages, got ${gasless.messages.length}`
    )
  }

  return { gasless, jettonAddress }
}

/**
 * Refuses a relay quote that does not spell out exactly the transfer the user
 * approved plus the commission the payload declares.
 *
 * The quote is what gets signed, and it comes from a server. Every co-signer
 * runs this against the payload before hashing, so neither the relay nor the
 * initiating device can slip in another destination, a different amount, a
 * message that deploys code, or a commission other than the one shown as the
 * fee. Only the structure the relay may legitimately touch — query ids, which
 * address takes the refund, how much TON each message attaches within a bound
 * — is left to it.
 */
export const assertTonGaslessQuote = (keysignPayload: KeysignPayload): void => {
  const { gasless, jettonAddress } = getTonGaslessQuoteSubject(keysignPayload)
  const commission = parseDecimal('commission', gasless.commission)
  const relay = Address.parse(gasless.relayAddress)
  const destination = Address.parse(keysignPayload.toAddress)
  const expectation: TonGaslessTransferExpectation = {
    amount: getKeysignAmount(keysignPayload),
    sender: Address.parse(getKeysignCoin(keysignPayload).address),
    relay,
    comment: keysignPayload.memo ?? '',
  }

  let transfers = 0
  let commissionPaid = 0n
  let attachedValue = 0n

  for (const message of gasless.messages) {
    const { body, value } = parseTonGaslessQuotedTransfer(message, jettonAddress)
    attachedValue += value

    if (body.destination.equals(destination)) {
      transfers += 1
      assertTonGaslessTransferBody(body, expectation)
    } else if (body.destination.equals(relay)) {
      commissionPaid += body.amount
    } else {
      throw new Error('Gasless TON quote contains a jetton transfer to an unexpected destination')
    }
  }

  if (transfers !== 1) {
    throw new Error(`Gasless TON quote must contain exactly one transfer to the receiver, found ${transfers}`)
  }
  if (commissionPaid !== commission) {
    throw new Error(`Gasless TON quote pays the relay ${commissionPaid}, but the declared commission is ${commission}`)
  }
  if (attachedValue > tonGaslessMaxAttachedValue) {
    throw new Error(
      `Gasless TON quote attaches ${attachedValue} nanotons, above the ${tonGaslessMaxAttachedValue} allowed`
    )
  }
}

type TonGaslessSigningInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
}

/**
 * Only a W5 wallet accepts a signed request from an internal message. The
 * payload names the wallet by its address, so the contract is resolved from
 * the address the way every TON keysign resolves it.
 */
const assertTonGaslessWallet = ({ keysignPayload, walletCore }: TonGaslessSigningInput): void => {
  const coin = getKeysignCoin(keysignPayload)
  const walletVersion = resolveTonWalletVersion({
    address: coin.address,
    publicKey: walletCore.PublicKey.createWithData(
      getKeysignTwPublicKey(keysignPayload),
      walletCore.PublicKeyType.ed25519
    ),
    walletCore,
  })

  if (walletVersion !== 'v5r1') {
    throw new Error('Only a W5 TON wallet can send a relayed (gasless) request; this account is V4R2')
  }
}

/**
 * The unsigned W5 `internal_signed` request for a gasless payload. Validates
 * the quote first, so a payload that fails validation never produces a hash to
 * sign.
 */
export const getTonGaslessSigningCell = (input: TonGaslessSigningInput): Cell => {
  assertTonGaslessWallet(input)
  assertTonGaslessQuote(input.keysignPayload)

  const { keysignPayload } = input
  const gasless = getKeysignTonGasless(keysignPayload)
  if (!gasless) {
    throw new Error('Keysign payload carries no gasless quote')
  }
  const { sequenceNumber, expireAt } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'tonSpecific')

  return buildTonGaslessSigningCell({
    validUntil: Number(expireAt),
    seqno: Number(sequenceNumber),
    messages: gasless.messages,
  })
}

/** The single pre-image a gasless TON request needs signed. */
export const getTonGaslessPreSigningHashes = (input: TonGaslessSigningInput): Uint8Array[] => [
  new Uint8Array(getTonGaslessSigningCell(input).hash()),
]

type CompileTonGaslessTxInput = TonGaslessSigningInput & {
  publicKey: PublicKey
  signatures: Record<string, KeysignSignature>
}

/**
 * Assembles the signed request for the relay as a TON `SigningOutput`:
 * `encoded` is the external envelope the relay accepts (with the wallet's
 * StateInit on a first request), and `hash` is the signed body's hash — the
 * only identifier fixed before the relay builds its own message around it.
 * The broadcast reports the relay's trace id instead when it gets one, and
 * falls back to this hash, which the status lookup also accepts.
 */
export const compileTonGaslessTx = ({
  keysignPayload,
  walletCore,
  publicKey,
  signatures,
}: CompileTonGaslessTxInput): Uint8Array => {
  const signingCell = getTonGaslessSigningCell({ keysignPayload, walletCore })
  const hash = new Uint8Array(signingCell.hash())
  const hashHex = Buffer.from(hash).toString('hex')

  const keysignSignature = signatures[hashHex]
  if (!keysignSignature) {
    throw new Error(`Missing signature for TON gasless request ${hashHex}`)
  }

  const signatureFormat = signatureFormats.ton
  const signature = generateSignature({
    walletCore,
    signature: keysignSignature,
    signatureFormat,
  })
  assertSignature({ publicKey, message: hash, signature, signatureFormat })

  const body = attachTonGaslessSignature({ signingCell, signature })
  const { sequenceNumber } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'tonSpecific')
  const stateInit =
    sequenceNumber === 0n
      ? buildTonV5R1StateInit({
          publicKey: getKeysignTwPublicKey(keysignPayload),
        })
      : undefined

  const message = buildTonGaslessExternalMessage({
    walletAddress: getKeysignCoin(keysignPayload).address,
    body,
    stateInit,
  })

  return TW.TheOpenNetwork.Proto.SigningOutput.encode(
    TW.TheOpenNetwork.Proto.SigningOutput.create({
      encoded: message.toBoc().toString('base64'),
      hash: new Uint8Array(body.hash()),
    })
  ).finish()
}
