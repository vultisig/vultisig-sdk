/**
 * Hand-rolled proto3 wire encoders for Osmosis messages.
 *
 * `cosmjs-types` ships the canonical Cosmos-SDK proto types (Coin, Any) and the
 * `BinaryWriter` proto3 wire encoder, but it does NOT vendor Osmosis-module
 * protos (gamm / concentratedliquidity / superfluid). Per the SDK's lib-vs-
 * hand-roll decision we hand-roll the handful of Osmosis msgs we need on top of
 * the `BinaryWriter` primitive rather than dragging in `osmojs` (multi-MB
 * data-as-dep, RN-hostile).
 *
 * Every field number / wire type below is verified against the on-chain
 * `osmosis-labs/osmosis` proto definitions (see the per-message doc comments).
 *
 * Wire-type cheatsheet (proto3):
 *   - tag = (field_number << 3) | wire_type
 *   - wire_type 0 = varint   (uint64, int64, bool, enum)
 *   - wire_type 2 = length-delimited (string, bytes, embedded message, packed repeated)
 *
 * `BinaryWriter` helpers used:
 *   - `.uint32(tag)`  writes the field tag as a varint
 *   - `.string(v)`    length-delimited UTF-8
 *   - `.uint64(v)` / `.int64(v)`  varint (accept string|bigint for big ints)
 *   - `.fork()` / `.ldelim()`  wrap an embedded/packed sub-message with its length prefix
 */
import { BinaryWriter } from 'cosmjs-types/binary'
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin'
import { Any } from 'cosmjs-types/google/protobuf/any'

import type { Coin as CoinInput, EncodedMsg } from './types'

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

const WIRE_VARINT = 0
const WIRE_LEN = 2

const tag = (fieldNumber: number, wireType: number): number => (fieldNumber << 3) | wireType

/** Append a repeated `cosmos.base.v1beta1.Coin` field (length-delimited each). */
function writeCoins(w: BinaryWriter, fieldNumber: number, coins: CoinInput[]): void {
  for (const c of coins) {
    w.uint32(tag(fieldNumber, WIRE_LEN))
    // Encode the Coin sub-message via the canonical cosmjs-types encoder, then
    // length-delimit it. `Coin.encode(msg, w.fork())` writes into a forked sub-
    // writer; `.ldelim()` back-patches the length prefix.
    Coin.encode({ denom: c.denom, amount: c.amount }, w.fork()).ldelim()
  }
}

/** Append a single (optional) `Coin` field. */
function writeCoin(w: BinaryWriter, fieldNumber: number, coin: CoinInput): void {
  w.uint32(tag(fieldNumber, WIRE_LEN))
  Coin.encode({ denom: coin.denom, amount: coin.amount }, w.fork()).ldelim()
}

/** Append a `string` field (skips empty strings — proto3 default). */
function writeString(w: BinaryWriter, fieldNumber: number, value: string): void {
  if (value === '') return
  w.uint32(tag(fieldNumber, WIRE_LEN)).string(value)
}

/** Append a `uint64` field (skips 0 — proto3 default). */
function writeUint64(w: BinaryWriter, fieldNumber: number, value: string | bigint): void {
  const v = typeof value === 'bigint' ? value : BigInt(value)
  if (v === 0n) return
  w.uint32(tag(fieldNumber, WIRE_VARINT)).uint64(v)
}

/**
 * Append a signed `int64` field. Skips 0 to match canonical gogoproto/proto3
 * encoding (default-valued scalars are omitted on the wire). A tick of exactly 0
 * is the proto default, so omitting it round-trips to 0 on decode — and Osmosis'
 * `lower < upper` invariant means both bounds are never 0 simultaneously.
 */
function writeInt64(w: BinaryWriter, fieldNumber: number, value: string | bigint): void {
  const v = typeof value === 'bigint' ? value : BigInt(value)
  if (v === 0n) return
  w.uint32(tag(fieldNumber, WIRE_VARINT)).int64(v)
}

/** Append a packed `repeated uint64` field (the proto3 default for scalar repeats). */
function writePackedUint64(w: BinaryWriter, fieldNumber: number, values: (string | bigint)[]): void {
  if (values.length === 0) return
  w.uint32(tag(fieldNumber, WIRE_LEN))
  const fork = w.fork()
  for (const value of values) {
    fork.uint64(typeof value === 'bigint' ? value : BigInt(value))
  }
  w.ldelim()
}

const finish = (typeUrl: string, w: BinaryWriter): EncodedMsg => ({ typeUrl, value: w.finish() })

// ---------------------------------------------------------------------------
// GAMM — osmosis.gamm.v1beta1
// https://github.com/osmosis-labs/osmosis/blob/main/proto/osmosis/gamm/v1beta1/tx.proto
// ---------------------------------------------------------------------------

export const TYPE_URL_JOIN_POOL = '/osmosis.gamm.v1beta1.MsgJoinPool'
export const TYPE_URL_EXIT_POOL = '/osmosis.gamm.v1beta1.MsgExitPool'
export const TYPE_URL_SWAP_EXACT_AMOUNT_IN = '/osmosis.gamm.v1beta1.MsgSwapExactAmountIn'

/** MsgJoinPool: sender(1), poolId(2 uint64), shareOutAmount(3), tokenInMaxs(4 repeated Coin). */
export function encodeMsgJoinPool(msg: {
  sender: string
  poolId: string | bigint
  shareOutAmount: string
  tokenInMaxs: CoinInput[]
}): EncodedMsg {
  const w = new BinaryWriter()
  writeString(w, 1, msg.sender)
  writeUint64(w, 2, msg.poolId)
  writeString(w, 3, msg.shareOutAmount)
  writeCoins(w, 4, msg.tokenInMaxs)
  return finish(TYPE_URL_JOIN_POOL, w)
}

/** MsgExitPool: sender(1), poolId(2 uint64), shareInAmount(3), tokenOutMins(4 repeated Coin). */
export function encodeMsgExitPool(msg: {
  sender: string
  poolId: string | bigint
  shareInAmount: string
  tokenOutMins: CoinInput[]
}): EncodedMsg {
  const w = new BinaryWriter()
  writeString(w, 1, msg.sender)
  writeUint64(w, 2, msg.poolId)
  writeString(w, 3, msg.shareInAmount)
  writeCoins(w, 4, msg.tokenOutMins)
  return finish(TYPE_URL_EXIT_POOL, w)
}

/**
 * MsgSwapExactAmountIn: sender(1), routes(2 repeated SwapAmountInRoute),
 * tokenIn(3 Coin), tokenOutMinAmount(4).
 * SwapAmountInRoute: poolId(1 uint64), tokenOutDenom(2 string).
 */
export function encodeMsgSwapExactAmountIn(msg: {
  sender: string
  routes: { poolId: string | bigint; tokenOutDenom: string }[]
  tokenIn: CoinInput
  tokenOutMinAmount: string
}): EncodedMsg {
  const w = new BinaryWriter()
  writeString(w, 1, msg.sender)
  for (const route of msg.routes) {
    w.uint32(tag(2, WIRE_LEN))
    const routeWriter = w.fork()
    writeUint64(routeWriter, 1, route.poolId)
    writeString(routeWriter, 2, route.tokenOutDenom)
    w.ldelim()
  }
  writeCoin(w, 3, msg.tokenIn)
  writeString(w, 4, msg.tokenOutMinAmount)
  return finish(TYPE_URL_SWAP_EXACT_AMOUNT_IN, w)
}

// ---------------------------------------------------------------------------
// Concentrated Liquidity — osmosis.concentratedliquidity.v1beta1
// https://github.com/osmosis-labs/osmosis/blob/main/proto/osmosis/concentratedliquidity/v1beta1/tx.proto
// ---------------------------------------------------------------------------

export const TYPE_URL_CL_CREATE_POSITION = '/osmosis.concentratedliquidity.v1beta1.MsgCreatePosition'
export const TYPE_URL_CL_WITHDRAW_POSITION = '/osmosis.concentratedliquidity.v1beta1.MsgWithdrawPosition'
export const TYPE_URL_CL_COLLECT_SPREAD_REWARDS = '/osmosis.concentratedliquidity.v1beta1.MsgCollectSpreadRewards'
export const TYPE_URL_CL_COLLECT_INCENTIVES = '/osmosis.concentratedliquidity.v1beta1.MsgCollectIncentives'

/**
 * MsgCreatePosition: poolId(1 uint64), sender(2), lowerTick(3 int64),
 * upperTick(4 int64), tokensProvided(5 repeated Coin), tokenMinAmount0(6),
 * tokenMinAmount1(7).
 * NOTE: poolId is field 1 (before sender) here — unlike the GAMM messages.
 */
export function encodeMsgCreatePosition(msg: {
  poolId: string | bigint
  sender: string
  lowerTick: string | bigint
  upperTick: string | bigint
  tokensProvided: CoinInput[]
  tokenMinAmount0: string
  tokenMinAmount1: string
}): EncodedMsg {
  const w = new BinaryWriter()
  writeUint64(w, 1, msg.poolId)
  writeString(w, 2, msg.sender)
  writeInt64(w, 3, msg.lowerTick)
  writeInt64(w, 4, msg.upperTick)
  writeCoins(w, 5, msg.tokensProvided)
  writeString(w, 6, msg.tokenMinAmount0)
  writeString(w, 7, msg.tokenMinAmount1)
  return finish(TYPE_URL_CL_CREATE_POSITION, w)
}

/** MsgWithdrawPosition: positionId(1 uint64), sender(2), liquidityAmount(3). */
export function encodeMsgWithdrawPosition(msg: {
  positionId: string | bigint
  sender: string
  liquidityAmount: string
}): EncodedMsg {
  const w = new BinaryWriter()
  writeUint64(w, 1, msg.positionId)
  writeString(w, 2, msg.sender)
  writeString(w, 3, msg.liquidityAmount)
  return finish(TYPE_URL_CL_WITHDRAW_POSITION, w)
}

/** MsgCollectSpreadRewards: positionIds(1 packed repeated uint64), sender(2). */
export function encodeMsgCollectSpreadRewards(msg: { positionIds: (string | bigint)[]; sender: string }): EncodedMsg {
  const w = new BinaryWriter()
  writePackedUint64(w, 1, msg.positionIds)
  writeString(w, 2, msg.sender)
  return finish(TYPE_URL_CL_COLLECT_SPREAD_REWARDS, w)
}

/** MsgCollectIncentives: positionIds(1 packed repeated uint64), sender(2). */
export function encodeMsgCollectIncentives(msg: { positionIds: (string | bigint)[]; sender: string }): EncodedMsg {
  const w = new BinaryWriter()
  writePackedUint64(w, 1, msg.positionIds)
  writeString(w, 2, msg.sender)
  return finish(TYPE_URL_CL_COLLECT_INCENTIVES, w)
}

// ---------------------------------------------------------------------------
// Superfluid — osmosis.superfluid
// https://github.com/osmosis-labs/osmosis/blob/main/proto/osmosis/superfluid/tx.proto
// ---------------------------------------------------------------------------

export const TYPE_URL_SUPERFLUID_DELEGATE = '/osmosis.superfluid.MsgSuperfluidDelegate'
export const TYPE_URL_SUPERFLUID_UNDELEGATE = '/osmosis.superfluid.MsgSuperfluidUndelegate'

/** MsgSuperfluidDelegate: sender(1), lockId(2 uint64), valAddr(3). */
export function encodeMsgSuperfluidDelegate(msg: {
  sender: string
  lockId: string | bigint
  valAddr: string
}): EncodedMsg {
  const w = new BinaryWriter()
  writeString(w, 1, msg.sender)
  writeUint64(w, 2, msg.lockId)
  writeString(w, 3, msg.valAddr)
  return finish(TYPE_URL_SUPERFLUID_DELEGATE, w)
}

/** MsgSuperfluidUndelegate: sender(1), lockId(2 uint64). */
export function encodeMsgSuperfluidUndelegate(msg: { sender: string; lockId: string | bigint }): EncodedMsg {
  const w = new BinaryWriter()
  writeString(w, 1, msg.sender)
  writeUint64(w, 2, msg.lockId)
  return finish(TYPE_URL_SUPERFLUID_UNDELEGATE, w)
}

// ---------------------------------------------------------------------------
// Any wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap an {@link EncodedMsg} in a `google.protobuf.Any`, returning the encoded
 * Any bytes. This is what a `TxBody.messages` entry holds on the wire.
 */
export function toAny(msg: EncodedMsg): Uint8Array {
  return Any.encode(Any.fromPartial({ typeUrl: msg.typeUrl, value: msg.value })).finish()
}
