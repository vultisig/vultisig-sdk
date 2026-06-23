/**
 * Unit tests for sdk.defi.osmosis message builders.
 *
 * Strategy: build each unsigned msg, assert the typeUrl, then decode the proto3
 * body bytes back with low-level cosmjs-types `BinaryReader` and assert every
 * field round-trips at the correct field number / wire type. This proves the
 * hand-rolled encoders match the on-chain proto layout (not just "it produced
 * some bytes"). Plus fund-safety validation cases (validator-vs-account guard,
 * bech32 checksum, decimal-amount rejection).
 */
import { BinaryReader } from 'cosmjs-types/binary'
import { Coin } from 'cosmjs-types/cosmos/base/v1beta1/coin'
import { Any } from 'cosmjs-types/google/protobuf/any'
import { describe, expect, it } from 'vitest'

import { osmosis } from '@/tools/defi'

// Deterministic, checksum-valid test addresses (20-byte payload).
const SENDER = 'osmo1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5helwsw'
const VALIDATOR = 'osmovaloper1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5dwhd8f'

const UOSMO = 'uosmo'
const IBC_USDC = 'ibc/498A0751C7AB1E5DF00ED54C3C8F11B1B0FE3A9CCDD80B73F2B7E03CB5BC4E78'

/**
 * Minimal proto3 field reader: walks the byte stream, returning a map of
 * fieldNumber -> [{ wireType, value }]. value is a bigint for varints and a
 * Uint8Array for length-delimited fields.
 */
function readFields(bytes: Uint8Array): Map<number, { wireType: number; value: bigint | Uint8Array }[]> {
  const reader = new BinaryReader(bytes)
  const out = new Map<number, { wireType: number; value: bigint | Uint8Array }[]>()
  while (reader.pos < bytes.length) {
    const tag = reader.uint32()
    const fieldNumber = tag >>> 3
    const wireType = tag & 7
    let value: bigint | Uint8Array
    if (wireType === 0) {
      value = BigInt(reader.uint64().toString())
    } else if (wireType === 2) {
      value = reader.bytes()
    } else {
      throw new Error(`unexpected wire type ${wireType} for field ${fieldNumber}`)
    }
    const arr = out.get(fieldNumber) ?? []
    arr.push({ wireType, value })
    out.set(fieldNumber, arr)
  }
  return out
}

const str = (v: bigint | Uint8Array): string => new TextDecoder().decode(v as Uint8Array)
const coin = (v: bigint | Uint8Array): { denom: string; amount: string } => {
  const c = Coin.decode(v as Uint8Array)
  return { denom: c.denom, amount: c.amount }
}

describe('sdk.defi.osmosis — GAMM', () => {
  it('builds MsgJoinPool with correct typeUrl + field layout', () => {
    const msg = osmosis.buildJoinPool({
      sender: SENDER,
      poolId: '1',
      shareOutAmount: '1000000000000000000',
      tokenInMaxs: [
        { denom: UOSMO, amount: '5000000' },
        { denom: IBC_USDC, amount: '100000' },
      ],
    })
    expect(msg.typeUrl).toBe('/osmosis.gamm.v1beta1.MsgJoinPool')
    const f = readFields(msg.value)
    expect(str(f.get(1)![0].value)).toBe(SENDER)
    expect(f.get(2)![0].value).toBe(1n)
    expect(str(f.get(3)![0].value)).toBe('1000000000000000000')
    const coins = f.get(4)!.map(e => coin(e.value))
    // sorted by denom deterministically (ibc/... < uosmo)
    expect(coins).toEqual([
      { denom: IBC_USDC, amount: '100000' },
      { denom: UOSMO, amount: '5000000' },
    ])
  })

  it('builds MsgExitPool', () => {
    const msg = osmosis.buildExitPool({
      sender: SENDER,
      poolId: '678',
      shareInAmount: '500000000000000000',
      tokenOutMins: [{ denom: UOSMO, amount: '1' }],
    })
    expect(msg.typeUrl).toBe('/osmosis.gamm.v1beta1.MsgExitPool')
    const f = readFields(msg.value)
    expect(f.get(2)![0].value).toBe(678n)
    expect(str(f.get(3)![0].value)).toBe('500000000000000000')
    expect(coin(f.get(4)![0].value)).toEqual({ denom: UOSMO, amount: '1' })
  })

  it('builds MsgSwapExactAmountIn with multi-hop routes', () => {
    const msg = osmosis.buildSwapExactAmountIn({
      sender: SENDER,
      routes: [
        { poolId: '1', tokenOutDenom: UOSMO },
        { poolId: '678', tokenOutDenom: IBC_USDC },
      ],
      tokenIn: { denom: IBC_USDC, amount: '1000000' },
      tokenOutMinAmount: '950000',
    })
    expect(msg.typeUrl).toBe('/osmosis.gamm.v1beta1.MsgSwapExactAmountIn')
    const f = readFields(msg.value)
    expect(str(f.get(1)![0].value)).toBe(SENDER)
    const routes = f.get(2)!.map(e => {
      const rf = readFields(e.value as Uint8Array)
      return { poolId: rf.get(1)![0].value, tokenOutDenom: str(rf.get(2)![0].value) }
    })
    expect(routes).toEqual([
      { poolId: 1n, tokenOutDenom: UOSMO },
      { poolId: 678n, tokenOutDenom: IBC_USDC },
    ])
    expect(coin(f.get(3)![0].value)).toEqual({ denom: IBC_USDC, amount: '1000000' })
    expect(str(f.get(4)![0].value)).toBe('950000')
  })
})

describe('sdk.defi.osmosis — Concentrated Liquidity', () => {
  it('builds MsgCreatePosition (poolId is field 1, before sender)', () => {
    const msg = osmosis.buildCreatePosition({
      sender: SENDER,
      poolId: '1066',
      lowerTick: '-887200',
      upperTick: '887200',
      tokensProvided: [
        { denom: UOSMO, amount: '5000000' },
        { denom: IBC_USDC, amount: '5000000' },
      ],
      tokenMinAmount0: '0',
      tokenMinAmount1: '0',
    })
    expect(msg.typeUrl).toBe('/osmosis.concentratedliquidity.v1beta1.MsgCreatePosition')
    const f = readFields(msg.value)
    expect(f.get(1)![0].value).toBe(1066n) // pool_id
    expect(str(f.get(2)![0].value)).toBe(SENDER) // sender
    // negative tick: int64 encodes as a full 10-byte varint, decoded as unsigned
    // here — reinterpret as signed 64-bit to confirm the value.
    const lowerUnsigned = f.get(3)![0].value as bigint
    const lowerSigned = BigInt.asIntN(64, lowerUnsigned)
    expect(lowerSigned).toBe(-887200n)
    expect(BigInt.asIntN(64, f.get(4)![0].value as bigint)).toBe(887200n)
    expect(f.get(5)!.map(e => coin(e.value))).toHaveLength(2)
  })

  it('omits a 0 lowerTick canonically (proto3 default) and round-trips to 0', () => {
    const msg = osmosis.buildCreatePosition({
      sender: SENDER,
      poolId: '1',
      lowerTick: '0',
      upperTick: '100',
      tokensProvided: [{ denom: UOSMO, amount: '1' }],
    })
    const f = readFields(msg.value)
    // field 3 (lowerTick=0) is omitted from the wire; absence decodes back to 0.
    expect(f.get(3)).toBeUndefined()
    expect(BigInt.asIntN(64, f.get(4)![0].value as bigint)).toBe(100n)
  })

  it('builds MsgWithdrawPosition with decimal liquidity', () => {
    const msg = osmosis.buildWithdrawPosition({
      sender: SENDER,
      positionId: '12345',
      liquidityAmount: '1000000.000000000000000000',
    })
    expect(msg.typeUrl).toBe('/osmosis.concentratedliquidity.v1beta1.MsgWithdrawPosition')
    const f = readFields(msg.value)
    expect(f.get(1)![0].value).toBe(12345n)
    expect(str(f.get(2)![0].value)).toBe(SENDER)
    expect(str(f.get(3)![0].value)).toBe('1000000.000000000000000000')
  })

  it('builds MsgCollectSpreadRewards with packed position_ids + dedup', () => {
    const msg = osmosis.buildCollectSpreadRewards({
      sender: SENDER,
      positionIds: ['5678', '1234', '5678'],
    })
    expect(msg.typeUrl).toBe('/osmosis.concentratedliquidity.v1beta1.MsgCollectSpreadRewards')
    const f = readFields(msg.value)
    // packed repeated uint64 -> one length-delimited field at #1
    const packed = f.get(1)![0].value as Uint8Array
    const r = new BinaryReader(packed)
    const ids: bigint[] = []
    while (r.pos < packed.length) ids.push(BigInt(r.uint64().toString()))
    expect(ids).toEqual([1234n, 5678n]) // deduped + sorted
    expect(str(f.get(2)![0].value)).toBe(SENDER)
  })

  it('builds MsgCollectIncentives', () => {
    const msg = osmosis.buildCollectIncentives({ sender: SENDER, positionIds: ['42'] })
    expect(msg.typeUrl).toBe('/osmosis.concentratedliquidity.v1beta1.MsgCollectIncentives')
  })
})

describe('sdk.defi.osmosis — Superfluid', () => {
  it('builds MsgSuperfluidDelegate', () => {
    const msg = osmosis.buildSuperfluidDelegate({
      sender: SENDER,
      lockId: '1234',
      valAddr: VALIDATOR,
    })
    expect(msg.typeUrl).toBe('/osmosis.superfluid.MsgSuperfluidDelegate')
    const f = readFields(msg.value)
    expect(str(f.get(1)![0].value)).toBe(SENDER)
    expect(f.get(2)![0].value).toBe(1234n)
    expect(str(f.get(3)![0].value)).toBe(VALIDATOR)
  })

  it('builds MsgSuperfluidUndelegate', () => {
    const msg = osmosis.buildSuperfluidUndelegate({ sender: SENDER, lockId: '1234' })
    expect(msg.typeUrl).toBe('/osmosis.superfluid.MsgSuperfluidUndelegate')
    const f = readFields(msg.value)
    expect(f.get(2)![0].value).toBe(1234n)
  })
})

describe('sdk.defi.osmosis — Any wrapping', () => {
  it('wraps a msg in google.protobuf.Any round-trippable by cosmjs-types', () => {
    const msg = osmosis.buildSuperfluidUndelegate({ sender: SENDER, lockId: '7' })
    const anyBytes = osmosis.toAny(msg)
    const decoded = Any.decode(anyBytes)
    expect(decoded.typeUrl).toBe('/osmosis.superfluid.MsgSuperfluidUndelegate')
    expect(decoded.value).toEqual(msg.value)
  })
})

describe('sdk.defi.osmosis — fund-safety validation', () => {
  it('rejects a validator address where an account is expected', () => {
    expect(() =>
      osmosis.buildJoinPool({
        sender: VALIDATOR,
        poolId: '1',
        shareOutAmount: '1',
        tokenInMaxs: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/validator operator address/)
  })

  it('rejects an account address where a validator is expected (valAddr)', () => {
    expect(() => osmosis.buildSuperfluidDelegate({ sender: SENDER, lockId: '1', valAddr: SENDER })).toThrow(
      /expected "osmovaloper" prefix/
    )
  })

  it('rejects a malformed bech32 (bad checksum)', () => {
    expect(() =>
      osmosis.buildExitPool({
        sender: 'osmo1notarealaddressxxxxxxxxxxxxxxxxxxxxxxxx',
        poolId: '1',
        shareInAmount: '1',
        tokenOutMins: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/malformed bech32/)
  })

  it('rejects a decimal share amount (sdk.Int requires whole integers)', () => {
    expect(() =>
      osmosis.buildJoinPool({
        sender: SENDER,
        poolId: '1',
        shareOutAmount: '1.5',
        tokenInMaxs: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/positive integer/)
  })

  it('rejects lowerTick >= upperTick', () => {
    expect(() =>
      osmosis.buildCreatePosition({
        sender: SENDER,
        poolId: '1',
        lowerTick: '100',
        upperTick: '100',
        tokensProvided: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/must be less than/)
  })

  // ---- uint64 / int64 silent-wrap guards (the encoder truncates mod 2^64) ----

  const U64_MAX = (1n << 64n) - 1n

  it('rejects a poolId above uint64 max (would wrap to a different pool)', () => {
    expect(() =>
      osmosis.buildJoinPool({
        sender: SENDER,
        poolId: (U64_MAX + 1n).toString(), // 2^64 -> wraps to 0 on the wire
        shareOutAmount: '1',
        tokenInMaxs: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/uint64 max/)
  })

  it('accepts poolId at exactly uint64 max (boundary)', () => {
    const msg = osmosis.buildJoinPool({
      sender: SENDER,
      poolId: U64_MAX.toString(),
      shareOutAmount: '1',
      tokenInMaxs: [{ denom: UOSMO, amount: '1' }],
    })
    expect(readFields(msg.value).get(2)![0].value).toBe(U64_MAX)
  })

  it('rejects a lockId above uint64 max (superfluid)', () => {
    expect(() => osmosis.buildSuperfluidUndelegate({ sender: SENDER, lockId: (U64_MAX + 1n).toString() })).toThrow(
      /uint64 max/
    )
  })

  it('rejects a positionId above uint64 max (collect)', () => {
    expect(() =>
      osmosis.buildCollectSpreadRewards({ sender: SENDER, positionIds: [(U64_MAX + 1n).toString()] })
    ).toThrow(/uint64 max/)
  })

  it('rejects a tick beyond the int64 domain (would wrap on the wire)', () => {
    const I64_MAX = (1n << 63n) - 1n
    expect(() =>
      osmosis.buildCreatePosition({
        sender: SENDER,
        poolId: '1',
        lowerTick: '0',
        upperTick: (I64_MAX + 1n).toString(),
        tokensProvided: [{ denom: UOSMO, amount: '1' }],
      })
    ).toThrow(/int64 range/)
  })
})
