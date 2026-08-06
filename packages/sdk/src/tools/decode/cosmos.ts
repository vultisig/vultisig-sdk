import { bech32 } from 'bech32'
import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { MsgDelegate, MsgUndelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'

import type { Envelope } from './types'

type Cw20Transfer = {
  amount: string
  recipient: string
}

const CW20_UINT128_MAX = (1n << 128n) - 1n

const decodeStrictUtf8 = (bytes: Uint8Array): string | undefined => {
  const decoded = Buffer.from(bytes).toString('utf8')
  const reencoded = Buffer.from(decoded, 'utf8')
  if (reencoded.length !== bytes.length || reencoded.some((byte, index) => byte !== bytes[index])) {
    return undefined
  }
  return decoded
}

const decodeAccountPrefix = (address: string): string | undefined => {
  let decoded: ReturnType<typeof bech32.decode>
  try {
    decoded = bech32.decode(address)
  } catch {
    return undefined
  }
  if (decoded.prefix.endsWith('valoper') || decoded.prefix.endsWith('valcons')) return undefined

  try {
    const payload = bech32.fromWords(decoded.words)
    if (payload.length !== 20 && payload.length !== 32) return undefined
  } catch {
    return undefined
  }
  return decoded.prefix
}

const decodeCw20Transfer = (bytes: Uint8Array, contract: string): Cw20Transfer | undefined => {
  const json = decodeStrictUtf8(bytes)
  if (json === undefined) return undefined

  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return undefined
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const payloadRecord = payload as Record<string, unknown>
  if (Object.keys(payloadRecord).length !== 1 || !('transfer' in payloadRecord)) return undefined

  const transfer = payloadRecord.transfer
  if (!transfer || typeof transfer !== 'object' || Array.isArray(transfer)) return undefined
  const transferRecord = transfer as Record<string, unknown>
  const transferKeys = Object.keys(transferRecord).sort()
  if (transferKeys.length !== 2 || transferKeys[0] !== 'amount' || transferKeys[1] !== 'recipient') {
    return undefined
  }

  const { amount, recipient } = transferRecord
  if (typeof recipient !== 'string' || typeof amount !== 'string') return undefined

  // The SDK builder emits this exact serialization. Requiring byte-for-byte
  // canonical JSON rejects duplicate keys, alternate key ordering, whitespace,
  // escapes, and parser-dependent ambiguity before lifting a transfer.
  if (json !== JSON.stringify({ transfer: { recipient, amount } })) return undefined

  const contractPrefix = decodeAccountPrefix(contract)
  if (!contractPrefix || decodeAccountPrefix(recipient) !== contractPrefix) return undefined
  if (!/^\d+$/.test(amount)) return undefined
  const amountValue = BigInt(amount)
  if (amountValue <= 0n || amountValue > CW20_UINT128_MAX) return undefined
  return { amount, recipient }
}

/**
 * Decode Cosmos proto3 tx bytes (TxRaw) into an Envelope.
 *
 * Decode chain: `TxRaw.decode(bytes)` → `bodyBytes` → `TxBody.decode` →
 * `messages: Any[]` → per-`typeUrl` typed `Msg.decode(any.value)`. This is the
 * canonical cosmjs-types path; we deliberately do NOT hand-roll a proto3 reader
 * (cluster-5 basis: cosmjs-types is the keystone — zero-dep, bigint, RN-safe).
 *
 * Mirrors the Go reference `populateFromCosmosTx`: only a single-message tx
 * yields recipient/amount. Multi-message txs fail closed (returning the first
 * message's recipient would let drift in the rest ride through as a pass).
 *
 * proto3 tx bytes carry NO chain id, so `Envelope.chain` is the caller hint.
 */
export function decodeCosmosTx(bytes: Uint8Array, chainHint: string): Envelope {
  const fail = (msg: string): Envelope => ({
    chain: chainHint,
    family: 'cosmos',
    kind: 'unknown',
    recipient: '',
    asset: { symbol: '', contract: '', decimals: 0 },
    amount: '',
    spender: '',
    decoded: false,
    decodeError: `cosmos: ${msg}`,
  })

  let body: TxBody
  try {
    const raw = TxRaw.decode(bytes)
    body = TxBody.decode(raw.bodyBytes)
  } catch (err) {
    return fail(`decode tx bytes failed: ${(err as Error).message}`)
  }

  const messages = body.messages ?? []
  if (messages.length === 0) return fail('tx body carries no messages')
  if (messages.length > 1) {
    return fail(`multi-message tx (${messages.length} messages) not supported by envelope decode`)
  }

  const env: Envelope = {
    chain: chainHint,
    family: 'cosmos',
    kind: 'unknown',
    recipient: '',
    asset: { symbol: '', contract: '', decimals: 0 },
    amount: '',
    spender: '',
    decoded: true,
    decodeError: '',
  }

  const any = messages[0]
  try {
    switch (any.typeUrl) {
      case '/cosmos.bank.v1beta1.MsgSend': {
        const msg = MsgSend.decode(any.value)
        if (msg.amount.length > 1) {
          return fail(`multi-coin MsgSend (${msg.amount.length} coins) not supported`)
        }
        env.kind = 'transfer'
        env.recipient = msg.toAddress
        const coin = msg.amount[0]
        if (coin) {
          env.amount = coin.amount
          env.asset.contract = coin.denom
          env.asset.symbol = denomToSymbol(coin.denom)
        }
        return env
      }
      case '/cosmos.staking.v1beta1.MsgDelegate': {
        const msg = MsgDelegate.decode(any.value)
        env.kind = 'delegate'
        env.recipient = msg.validatorAddress
        if (msg.amount) {
          env.amount = msg.amount.amount
          env.asset.contract = msg.amount.denom
          env.asset.symbol = denomToSymbol(msg.amount.denom)
        }
        return env
      }
      case '/cosmos.staking.v1beta1.MsgUndelegate': {
        const msg = MsgUndelegate.decode(any.value)
        env.kind = 'undelegate'
        env.recipient = msg.validatorAddress
        if (msg.amount) {
          env.amount = msg.amount.amount
          env.asset.contract = msg.amount.denom
          env.asset.symbol = denomToSymbol(msg.amount.denom)
        }
        return env
      }
      case '/cosmwasm.wasm.v1.MsgExecuteContract': {
        const msg = MsgExecuteContract.decode(any.value)
        // CW20 transfers live inside the JSON `msg`; the on-wire recipient is
        // the contract being executed. Recognize only the SDK builder's direct
        // transfer shape with no attached native funds; any extra action/value
        // remains a generic contract call so no hidden effect rides through.
        const transfer = msg.funds.length === 0 ? decodeCw20Transfer(msg.msg, msg.contract) : undefined
        if (transfer) {
          env.kind = 'transfer'
          env.recipient = transfer.recipient
          env.amount = transfer.amount
          env.asset.contract = msg.contract
          return env
        }

        env.kind = 'contractCall'
        env.recipient = msg.contract
        if (msg.funds.length === 1) {
          const coin = msg.funds[0]
          env.amount = coin.amount
          env.asset.contract = coin.denom
          env.asset.symbol = denomToSymbol(coin.denom)
        }
        return env
      }
      default:
        // Decoded the envelope but not this message kind — recipient/amount
        // unknown, but the tx itself is structurally valid.
        env.kind = 'unknown'
        return env
    }
  } catch (err) {
    return fail(`decode message ${any.typeUrl} failed: ${(err as Error).message}`)
  }
}

/**
 * Best-effort symbol from a Cosmos denom. `uatom` → `ATOM`, `uosmo` → `OSMO`.
 * IBC / factory denoms (`ibc/...`, `factory/...`) and native staking denoms are
 * left as-is uppercased; the caller's token registry can refine if needed.
 */
function denomToSymbol(denom: string): string {
  if (!denom) return ''
  if (denom.startsWith('ibc/') || denom.startsWith('factory/')) return ''
  // micro-denom convention: leading "u" + ticker.
  if (denom.length > 1 && denom.startsWith('u') && /^[a-z]+$/.test(denom)) {
    return denom.slice(1).toUpperCase()
  }
  return denom.toUpperCase()
}
