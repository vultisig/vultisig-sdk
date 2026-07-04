import { MsgSend } from 'cosmjs-types/cosmos/bank/v1beta1/tx'
import { MsgDelegate, MsgUndelegate } from 'cosmjs-types/cosmos/staking/v1beta1/tx'
import { TxBody, TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { MsgExecuteContract } from 'cosmjs-types/cosmwasm/wasm/v1/tx'

import type { Envelope } from './types'

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
        // the contract being executed. Lift a single attached fund if present.
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
