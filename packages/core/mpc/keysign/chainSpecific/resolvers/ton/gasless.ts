import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { Address, beginCell, internal, storeMessageRelaxed } from '@ton/core'
import { areEqualTonAddresses } from '@vultisig/core-chain/chains/ton/address'
import { tonConfig } from '@vultisig/core-chain/chains/ton/config'
import { estimateTonGasless, getTonGaslessConfig, isTonGasJetton } from '@vultisig/core-chain/chains/ton/gasless/api'
import { resolveTonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'
import { attempt } from '@vultisig/lib-utils/attempt'
import { extractErrorMsg } from '@vultisig/lib-utils/error/extractErrorMsg'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'
import { WalletCore } from '@trustwallet/wallet-core'

import {
  TonGasless,
  TonGaslessSchema,
  TonSpecificSchema,
} from '../../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayload } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { TonMessageSchema } from '../../../../types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { BuildKeysignPayloadError } from '../../../error'
import { assertTonGaslessQuote, buildTonGaslessTransferBody } from '../../../ton/gasless'
import { getKeysignTwPublicKey } from '../../../tw/getKeysignTwPublicKey'
import { getKeysignCoin } from '../../../utils/getKeysignCoin'

/** The relay's wording when the jetton balance does not cover the transfer plus its commission. */
const isRelayInsufficientFundsRefusal = (message: string): boolean => /enough (tokens|jettons)/i.test(message)

type GetTonGaslessQuoteInput = {
  keysignPayload: KeysignPayload
  walletCore: WalletCore
  /** The sender's jetton wallet, already resolved. */
  jettonAddress: string
  isActiveDestination: boolean
}

export type TonGaslessQuoteFields = {
  gasless: TonGasless
  /** The relay's deadline, unix seconds; the request must expire no later. */
  validUntil: number
}

/**
 * Prices the transfer with the relay and records the quote in the payload.
 *
 * Gasless is a W5 feature and pays the commission in the jetton being sent, so
 * a V4R2 account, a native TON send or a jetton the relay does not accept are
 * refused as bad input rather than retried. The quote is checked against the
 * payload the way every signer will check it, so the initiator finds out here
 * — before the user reviews anything — if the relay returned something the
 * vault would refuse to sign.
 */
export const getTonGaslessQuote = async ({
  keysignPayload,
  walletCore,
  jettonAddress,
  isActiveDestination,
}: GetTonGaslessQuoteInput): Promise<TonGaslessQuoteFields> => {
  const coin = getKeysignCoin(keysignPayload)
  if (!coin.id) {
    throw new BuildKeysignPayloadError(
      'ton-gasless-unsupported',
      'Only a jetton transfer can pay its fee in the jetton; native TON always pays in TON'
    )
  }

  const publicKeyBytes = getKeysignTwPublicKey(keysignPayload)
  const walletVersion = resolveTonWalletVersion({
    address: coin.address,
    publicKey: walletCore.PublicKey.createWithData(publicKeyBytes, walletCore.PublicKeyType.ed25519),
    walletCore,
  })
  if (walletVersion !== 'v5r1') {
    throw new BuildKeysignPayloadError(
      'ton-gasless-unsupported',
      'Gasless transfers need the W5 wallet contract; this account is V4R2'
    )
  }

  const config = await getTonGaslessConfig()
  if (!isTonGasJetton(config, coin.id)) {
    throw new BuildKeysignPayloadError('ton-gasless-unsupported', `The relay does not accept ${coin.ticker} as a fee`)
  }

  const transfer = beginCell()
    .store(
      storeMessageRelaxed(
        internal({
          to: Address.parse(jettonAddress),
          value: tonConfig.jettonAmount,
          bounce: true,
          body: buildTonGaslessTransferBody({
            keysignPayload,
            relayAddress: config.relayAddress,
            isActiveDestination,
          }),
        })
      )
    )
    .endCell()

  const estimate = await attempt(
    estimateTonGasless({
      gasJettonMaster: coin.id,
      walletAddress: Address.parse(coin.address).toRawString(),
      walletPublicKeyHex: Buffer.from(publicKeyBytes).toString('hex'),
      messages: [transfer],
    })
  )
  if ('error' in estimate) {
    // A 4xx is the relay declining this request and will not change on retry;
    // anything else is the relay being unreachable and stays a plain, retryable
    // error. The relay refuses a transfer that leaves no room for its commission
    // whatever the "throw if not enough jettons" flag says, so that refusal is
    // the ordinary insufficient-funds outcome; the rest (unknown wallet, a jetton
    // it will not price, …) means gasless is not on offer for this send.
    if (estimate.error instanceof HttpResponseError && estimate.error.status < 500) {
      const message = extractErrorMsg(estimate.error)
      throw new BuildKeysignPayloadError(
        isRelayInsufficientFundsRefusal(message) ? 'not-enough-funds' : 'ton-gasless-unsupported',
        message
      )
    }

    throw estimate.error
  }
  const quote = estimate.data

  if (!areEqualTonAddresses(quote.relayAddress, config.relayAddress)) {
    throw new BuildKeysignPayloadError(
      'ton-gasless-quote-invalid',
      'The relay quoted a commission address other than the one it publishes'
    )
  }

  const gasless = create(TonGaslessSchema, {
    relayAddress: config.relayAddress,
    gasJettonMaster: coin.id,
    commission: quote.commission.toString(),
    messages: quote.messages.map(({ to, amount, payload, stateInit }) =>
      create(TonMessageSchema, { to, amount, payload, stateInit })
    ),
  })

  // Judged exactly as a signer will judge it, with the fields the signer reads.
  const checked = attempt(() =>
    assertTonGaslessQuote({
      ...keysignPayload,
      blockchainSpecific: {
        case: 'tonSpecific',
        value: create(TonSpecificSchema, {
          jettonAddress,
          isActiveDestination,
          gasless,
        }),
      },
    })
  )
  if ('error' in checked) {
    throw new BuildKeysignPayloadError('ton-gasless-quote-invalid', extractErrorMsg(checked.error))
  }

  return { gasless, validUntil: quote.validUntil }
}
