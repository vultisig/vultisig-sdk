import { Cell } from '@ton/core'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { areEqualTonAddresses } from '../address'
import { tonPayloadToBase64 } from '../messageBody/decode'
import { tonApiPublicUrl } from '../tonApi'

/**
 * What the relay publishes: where it lives and which jettons it accepts the
 * commission in. Only a jetton on this list can pay for a gasless transfer.
 */
export type TonGaslessConfig = {
  relayAddress: string
  gasJettonMasters: string[]
}

type GaslessConfigResponse = {
  relay_address: string
  gas_jettons: { master_id: string }[]
}

const gaslessUrl = `${tonApiPublicUrl}/v2/gasless`

/** Fetches the relay's address and the jettons it takes commission in. */
export const getTonGaslessConfig = async (): Promise<TonGaslessConfig> => {
  const { relay_address, gas_jettons } = await queryUrl<GaslessConfigResponse>(`${gaslessUrl}/config`)

  return {
    relayAddress: relay_address,
    gasJettonMasters: gas_jettons.map(({ master_id }) => master_id),
  }
}

/** Whether the relay accepts commission in this jetton. */
export const isTonGasJetton = ({ gasJettonMasters }: TonGaslessConfig, jettonMaster: string): boolean =>
  gasJettonMasters.some(master => areEqualTonAddresses(master, jettonMaster))

/**
 * One internal message the relay wants the wallet to sign. `payload` and
 * `stateInit` are single-cell BOCs in base64, the same encoding TonConnect
 * messages carry, so the keysign payload can hold them as `TonMessage`s.
 */
export type TonGaslessQuotedMessage = {
  to: string
  /** Nanotons attached to the message, as a decimal string. */
  amount: string
  payload?: string
  stateInit?: string
}

/** The relay's answer to an estimate: what to sign and what it charges. */
export type TonGaslessQuote = {
  relayAddress: string
  /** In the gas jetton's minimal units. */
  commission: bigint
  /** Unix seconds after which the relay will no longer accept the request. */
  validUntil: number
  messages: TonGaslessQuotedMessage[]
  protocolName: string
}

type SignRawMessage = {
  address: string
  amount: string
  payload?: string
  stateInit?: string
}

type SignRawParamsResponse = {
  protocol_name: string
  relay_address: string
  commission: string
  from: string
  valid_until: number
  messages: SignRawMessage[]
}

type EstimateTonGaslessInput = {
  gasJettonMaster: string
  walletAddress: string
  /** The wallet's Ed25519 public key, hex. The relay derives the W5 account from it. */
  walletPublicKeyHex: string
  /** The internal messages the wallet wants to send, as `MessageRelaxed` cells. */
  messages: Cell[]
}

const decimalPattern = /^\d+$/

const parseDecimal = (field: string, value: string): bigint => {
  if (!decimalPattern.test(value)) {
    throw new Error(`TON gasless relay returned a non-numeric ${field}: ${value}`)
  }

  return BigInt(value)
}

const toQuotedMessage = ({ address, amount, payload, stateInit }: SignRawMessage): TonGaslessQuotedMessage => {
  parseDecimal('message amount', amount)

  return {
    to: address,
    amount,
    payload: tonPayloadToBase64(payload) ?? undefined,
    stateInit: tonPayloadToBase64(stateInit) ?? undefined,
  }
}

/**
 * Asks the relay to price a transfer paid in `gasJettonMaster`. The relay
 * answers with the full list of messages the wallet has to sign — the
 * caller's own messages plus the commission transfer — which the caller must
 * validate before signing: nothing here checks that the relay kept the
 * transfer intact. The relay refuses a transfer that leaves no room for its
 * commission in the jetton balance, whatever the "throw if not enough
 * jettons" flag says, so a full-balance transfer cannot be priced; the fee
 * estimate quotes the smallest transfer instead.
 */
export const estimateTonGasless = async ({
  gasJettonMaster,
  walletAddress,
  walletPublicKeyHex,
  messages,
}: EstimateTonGaslessInput): Promise<TonGaslessQuote> => {
  const response = await queryUrl<SignRawParamsResponse>(
    `${gaslessUrl}/estimate/${encodeURIComponent(gasJettonMaster)}`,
    {
      body: {
        wallet_address: walletAddress,
        wallet_public_key: walletPublicKeyHex,
        messages: messages.map(message => ({
          boc: message.toBoc().toString('hex'),
        })),
        throw_error_if_not_enough_jettons: false,
        return_emulation: false,
      },
    }
  )

  if (!Array.isArray(response.messages) || response.messages.length === 0) {
    throw new Error('TON gasless relay returned no messages to sign')
  }

  return {
    relayAddress: response.relay_address,
    commission: parseDecimal('commission', response.commission),
    validUntil: response.valid_until,
    messages: response.messages.map(toQuotedMessage),
    protocolName: response.protocol_name,
  }
}

type SendTonGaslessInput = {
  /** The signed W5 `internal_signed` request wrapped in an external message, base64 BOC. */
  boc: string
  walletPublicKeyHex?: string
}

type GaslessTxResponse = {
  protocol_name: string
  /** Normalized hash of the external message the relay broadcast, when it reports one. */
  external?: string
}

/** Hands the signed request to the relay, which wraps it in an internal message it pays for. */
export const sendTonGasless = async ({ boc, walletPublicKeyHex }: SendTonGaslessInput): Promise<GaslessTxResponse> =>
  queryUrl<GaslessTxResponse>(`${gaslessUrl}/send`, {
    body: {
      boc,
      ...(walletPublicKeyHex ? { wallet_public_key: walletPublicKeyHex } : {}),
    },
  })
