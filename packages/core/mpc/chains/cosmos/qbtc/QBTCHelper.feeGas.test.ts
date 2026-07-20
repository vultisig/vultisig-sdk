/**
 * QBTCHelper fee/gas golden vectors (sdk#1366).
 *
 * QBTC bypasses WalletCore on a hand-rolled proto encoder and, until this suite, had NO test
 * driving the fee/gas-limit split of getQBTCSignedTransaction end to end. The round-7 audit
 * SUSPECTED a P0 fee/gas conflation - that `cosmosSpecific.gas` (feared to be a gas-LIMIT-shaped
 * number) was being written as the fee AMOUNT. It is NOT: the CosmosSpecific proto documents field
 * 3 `gas` as "the fee AMOUNT (not a limit)" and field 7 `gasLimit` as the per-tx limit. These
 * vectors PIN that split so a future refactor can't silently swap them, and lock the two behaviours
 * this suite also fixes: (1) the fee coin denom+amount comes from `gas`; (2) the gas limit now
 * honours field-7 `gasLimit` when set, falling back to the 300_000 default when unset.
 *
 * IMPORTANT for whoever populates field 7 next: QBTC's fee is DELIBERATELY FLAT. Unlike the shared
 * standard-cosmos helper `resolveCosmosGasFee` (which SCALES the fee amount proportionally when the
 * limit exceeds the static limit, so gas price is held constant and the tx "pays for the extra
 * gas"), QBTC writes `fee.amount = cosmosSpecific.gas` verbatim regardless of the limit. This is
 * intentional and consistent today: QBTC bypasses `resolveCosmosGasFee` entirely, and its fee
 * DISPLAY (`getQbtcFeeAmount`) also returns raw `gas`, so shown == signed with no drift. So field 7
 * is honoured as the LIMIT only; it does NOT (and must not silently) re-scale the fee. Making QBTC
 * scale its fee would be a coordinated change across the fee-display resolver, the signing encoder,
 * AND every co-signer (gasLimit is part of the SignDoc). QBTC is also a post-quantum TESTNET
 * (Chain.ts) - the fee posture here is low-stakes; do not re-run the P0 fire drill over it.
 */
import { Buffer } from 'buffer'
import { create } from '@bufbuild/protobuf'
import { AuthInfo } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
import { describe, expect, it } from 'vitest'

import { CosmosSpecificSchema, TransactionType } from '../../../types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../types/vultisig/keysign/v1/keysign_message_pb'
import { getQBTCPreSignedImageHash, getQBTCSignedTransaction } from './QBTCHelper'

const SENDER = 'qbtc1sender00000000000000000000000000000000'
const RECEIVER = 'qbtc1receiver0000000000000000000000000000000'
const MLDSA_PUBKEY_HEX = 'aa'.repeat(32)

const buildPayload = () =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: 'QBTC',
      ticker: 'QBTC',
      address: SENDER,
      decimals: 8,
      isNativeToken: true,
      hexPublicKey: MLDSA_PUBKEY_HEX,
    }),
    toAddress: RECEIVER,
    toAmount: '123456',
    memo: '',
  })

// gas = FEE AMOUNT (proto field 3), gasLimit = GAS LIMIT (proto field 7).
const buildCosmosSpecific = ({ gas, gasLimit }: { gas: bigint; gasLimit?: bigint }) =>
  create(CosmosSpecificSchema, {
    accountNumber: 7n,
    sequence: 3n,
    gas,
    gasLimit,
    transactionType: TransactionType.UNSPECIFIED,
  })

/** Decode the fee coin (denom, amount) and gas_limit out of the serialized tx's authInfo. */
const decodeFee = (serialized: string) => {
  const { tx_bytes } = JSON.parse(serialized) as { tx_bytes: string }
  // TxRaw = [ body(1), authInfo(2), signature(3) ]; pull field 2 (authInfo) then decode it.
  const txRaw = new Uint8Array(Buffer.from(tx_bytes, 'base64'))
  const authInfoBytes = extractProtoField(txRaw, 2)
  const authInfo = AuthInfo.decode(authInfoBytes)
  const feeCoin = authInfo.fee?.amount?.[0]
  return {
    denom: feeCoin?.denom,
    amount: feeCoin?.amount,
    gasLimit: authInfo.fee?.gasLimit?.toString(),
  }
}

/** Minimal length-delimited proto field reader for a top-level field number (fields are wire-type 2). */
const extractProtoField = (bytes: Uint8Array, field: number): Uint8Array => {
  let i = 0
  while (i < bytes.length) {
    const tag = bytes[i]!
    const fieldNo = tag >> 3
    i += 1
    // read length varint
    let len = 0
    let shift = 0
    while (true) {
      const b = bytes[i]!
      len |= (b & 0x7f) << shift
      i += 1
      if ((b & 0x80) === 0) break
      shift += 7
    }
    if (fieldNo === field) return bytes.slice(i, i + len)
    i += len
  }
  throw new Error(`proto field ${field} not found`)
}

const SIGNATURES = (
  payload: ReturnType<typeof buildPayload>,
  cosmosSpecific: ReturnType<typeof buildCosmosSpecific>
) => {
  const [hash] = getQBTCPreSignedImageHash({ keysignPayload: payload, cosmosSpecific })
  const hashHex = Buffer.from(hash!).toString('hex')
  return { [hashHex]: { msg: '', r: '', s: '', der_signature: '55'.repeat(64) } }
}

describe('QBTCHelper — fee/gas split golden vectors (sdk#1366)', () => {
  it('writes cosmosSpecific.gas as the fee AMOUNT (not the gas limit) for a MsgSend', () => {
    const payload = buildPayload()
    const cosmosSpecific = buildCosmosSpecific({ gas: 2500n })
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload: payload,
      cosmosSpecific,
      signatures: SIGNATURES(payload, cosmosSpecific),
    })

    const fee = decodeFee(serialized)
    expect(fee.denom).toBe('qbtc')
    expect(fee.amount).toBe('2500') // the fee amount == cosmosSpecific.gas, NOT a 300k-shaped limit
  })

  it('defaults the gas LIMIT to 300000 when field-7 gasLimit is unset', () => {
    const payload = buildPayload()
    const cosmosSpecific = buildCosmosSpecific({ gas: 2500n }) // no gasLimit
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload: payload,
      cosmosSpecific,
      signatures: SIGNATURES(payload, cosmosSpecific),
    })

    expect(decodeFee(serialized).gasLimit).toBe('300000')
  })

  it('honours field-7 gasLimit when set (a QBTC tx needing more headroom is no longer capped at 300000)', () => {
    const payload = buildPayload()
    const cosmosSpecific = buildCosmosSpecific({ gas: 2500n, gasLimit: 550000n })
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload: payload,
      cosmosSpecific,
      signatures: SIGNATURES(payload, cosmosSpecific),
    })

    const fee = decodeFee(serialized)
    // QBTC's fee is DELIBERATELY flat: it stays == cosmosSpecific.gas even as the limit grows. This
    // is NOT the resolveCosmosGasFee rule (that scales the fee with the limit); see the file
    // docstring. Field 7 is honoured as the LIMIT only - it must not silently re-scale the fee.
    expect(fee.amount).toBe('2500')
    expect(fee.gasLimit).toBe('550000') // limit now tracks field-7 gasLimit
  })

  it('falls back to 300000 when field-7 gasLimit is an explicit 0 (proto3 would elide it → invalid zero-gas tx)', () => {
    // Field 7 is `optional uint64`, so 0n is a representable value distinct from unset. Without the
    // `> 0n` guard in buildQBTCAuthInfo, protoVarint(2, 0n) elides gas_limit entirely and the tx
    // signs with zero gas (invalid). The guard coerces 0n (and any non-positive) back to the default.
    const payload = buildPayload()
    const cosmosSpecific = buildCosmosSpecific({ gas: 2500n, gasLimit: 0n })
    const { serialized } = getQBTCSignedTransaction({
      keysignPayload: payload,
      cosmosSpecific,
      signatures: SIGNATURES(payload, cosmosSpecific),
    })

    const fee = decodeFee(serialized)
    expect(fee.amount).toBe('2500')
    expect(fee.gasLimit).toBe('300000')
  })
})
