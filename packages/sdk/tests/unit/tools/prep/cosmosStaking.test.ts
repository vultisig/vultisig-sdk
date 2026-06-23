import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'

import {
  buildDelegateMsg,
  buildRedelegateMsg,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  cosmosStaking,
} from '@/tools/prep/cosmosStaking'

// ---------------------------------------------------------------------------
// Minimal protobuf reader — decodes the length-delimited wire bytes back into
// { fieldNum -> value } so we assert on the actual encoded structure, not just
// our own re-encode. Only handles wire types 0/2 (varint + length-delimited),
// which is all the staking/distribution msgs use.
// ---------------------------------------------------------------------------
type Field = { num: number; wire: number; bytes: Uint8Array }

function readVarint(buf: Uint8Array, pos: number): { value: number; pos: number } {
  let value = 0
  let shift = 0
  let p = pos
  for (;;) {
    const b = buf[p++]
    value |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return { value: value >>> 0, pos: p }
}

function decode(buf: Uint8Array): Field[] {
  const fields: Field[] = []
  let pos = 0
  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    pos = tag.pos
    const num = tag.value >>> 3
    const wire = tag.value & 0x7
    if (wire === 2) {
      const len = readVarint(buf, pos)
      pos = len.pos
      fields.push({ num, wire, bytes: buf.slice(pos, pos + len.value) })
      pos += len.value
    } else if (wire === 0) {
      const v = readVarint(buf, pos)
      fields.push({ num, wire, bytes: buf.slice(pos, v.pos) })
      pos = v.pos
    } else {
      throw new Error(`unexpected wire type ${wire}`)
    }
  }
  return fields
}

const str = (b: Uint8Array) => new TextDecoder().decode(b)
const valueBytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

const OSMO_DEL = 'osmo1runz6dpmgfy4q467v4k8x75p3z8ed8dyxqlpht'
const OSMO_VAL = 'osmovaloper18ez5c566v95x7anasj9e9xdq57htt0xrztjrg0'
const OSMO_VAL_2 = 'osmovaloper1t4jxkuneszrca9vu5w4trw9lcmxafklzjq8gpk'

describe('cosmosStaking pure msg builders', () => {
  it('buildDelegateMsg encodes MsgDelegate { delegator, validator, Coin }', () => {
    const env = buildDelegateMsg({
      delegatorAddress: OSMO_DEL,
      validatorAddress: OSMO_VAL,
      amount: '5000000',
      denom: 'uosmo',
    })
    expect(env.typeUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')

    const f = decode(valueBytes(env.valueBase64))
    expect(str(f.find(x => x.num === 1)!.bytes)).toBe(OSMO_DEL)
    expect(str(f.find(x => x.num === 2)!.bytes)).toBe(OSMO_VAL)

    // field 3 is the nested Coin { denom = 1, amount = 2 }
    const coin = decode(f.find(x => x.num === 3)!.bytes)
    expect(str(coin.find(x => x.num === 1)!.bytes)).toBe('uosmo')
    expect(str(coin.find(x => x.num === 2)!.bytes)).toBe('5000000')
  })

  it('buildUndelegateMsg shares the wire layout, only the typeUrl differs', () => {
    const del = buildDelegateMsg({
      delegatorAddress: OSMO_DEL,
      validatorAddress: OSMO_VAL,
      amount: '5000000',
      denom: 'uosmo',
    })
    const undel = buildUndelegateMsg({
      delegatorAddress: OSMO_DEL,
      validatorAddress: OSMO_VAL,
      amount: '5000000',
      denom: 'uosmo',
    })
    expect(undel.typeUrl).toBe('/cosmos.staking.v1beta1.MsgUndelegate')
    // identical proto body, different Any typeUrl
    expect(undel.valueBase64).toBe(del.valueBase64)
  })

  it('buildRedelegateMsg encodes MsgBeginRedelegate { delegator, src, dst, Coin }', () => {
    const env = buildRedelegateMsg({
      delegatorAddress: OSMO_DEL,
      validatorSrcAddress: OSMO_VAL,
      validatorDstAddress: OSMO_VAL_2,
      amount: '1000000',
      denom: 'uosmo',
    })
    expect(env.typeUrl).toBe('/cosmos.staking.v1beta1.MsgBeginRedelegate')

    const f = decode(valueBytes(env.valueBase64))
    expect(str(f.find(x => x.num === 1)!.bytes)).toBe(OSMO_DEL)
    expect(str(f.find(x => x.num === 2)!.bytes)).toBe(OSMO_VAL)
    expect(str(f.find(x => x.num === 3)!.bytes)).toBe(OSMO_VAL_2)
    const coin = decode(f.find(x => x.num === 4)!.bytes)
    expect(str(coin.find(x => x.num === 1)!.bytes)).toBe('uosmo')
    expect(str(coin.find(x => x.num === 2)!.bytes)).toBe('1000000')
  })

  it('buildWithdrawRewardsMsg encodes MsgWithdrawDelegatorReward { delegator, validator }', () => {
    const env = buildWithdrawRewardsMsg({
      delegatorAddress: OSMO_DEL,
      validatorAddress: OSMO_VAL,
    })
    expect(env.typeUrl).toBe('/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward')

    const f = decode(valueBytes(env.valueBase64))
    expect(str(f.find(x => x.num === 1)!.bytes)).toBe(OSMO_DEL)
    expect(str(f.find(x => x.num === 2)!.bytes)).toBe(OSMO_VAL)
    expect(f.find(x => x.num === 3)).toBeUndefined()
  })

  it('namespace surface maps to the same builders', () => {
    expect(cosmosStaking.delegate).toBe(buildDelegateMsg)
    expect(cosmosStaking.undelegate).toBe(buildUndelegateMsg)
    expect(cosmosStaking.redelegate).toBe(buildRedelegateMsg)
    expect(cosmosStaking.withdraw).toBe(buildWithdrawRewardsMsg)
  })

  describe('validation guards (fund-safety)', () => {
    it('rejects a malformed bech32 delegator', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: 'not-an-address',
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: 'uosmo',
        })
      ).toThrow(/malformed bech32/)
    })

    it('rejects a non-positive amount', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_VAL,
          amount: '0',
          denom: 'uosmo',
        })
      ).toThrow(/positive integer/)
    })

    it('rejects a non-integer / fractional amount', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_VAL,
          amount: '5.5',
          denom: 'uosmo',
        })
      ).toThrow(/positive integer/)
    })

    it('rejects an empty denom', () => {
      expect(() =>
        buildUndelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: '   ',
        })
      ).toThrow(/non-empty string/)
    })

    it('rejects redelegate with identical src/dst validators', () => {
      expect(() =>
        buildRedelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorSrcAddress: OSMO_VAL,
          validatorDstAddress: OSMO_VAL,
          amount: '1000000',
          denom: 'uosmo',
        })
      ).toThrow(/must differ/)
    })

    it('enforces the expected hrp when accountPrefix/validatorPrefix are passed', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: 'uosmo',
          accountPrefix: 'cosmos',
        })
      ).toThrow(/expected cosmos prefix/)
    })

    // -----------------------------------------------------------------------
    // Role guard (always on, prefix-independent) — ports mcp-ts
    // assertNotValidatorHrp into the SDK's optional-prefix happy path. A
    // valoper/valcons handed in as the delegator/account field must be
    // rejected BEFORE any signing-ready bytes are emitted, even when NO
    // accountPrefix is supplied. Regression: the original SDK port dropped
    // this guard, so a valoper-as-delegator built a valid MsgDelegate.
    // -----------------------------------------------------------------------
    it('rejects a validator OPERATOR address handed in as the delegator (no prefix passed)', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_VAL, // valoper in the account slot
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: 'uosmo',
        })
      ).toThrow(/validator key, not a spendable account/)
    })

    it('rejects a valoper delegator on undelegate too (no prefix passed)', () => {
      expect(() =>
        buildUndelegateMsg({
          delegatorAddress: OSMO_VAL,
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: 'uosmo',
        })
      ).toThrow(/validator key, not a spendable account/)
    })

    it('rejects a valoper delegator on redelegate (no prefix passed)', () => {
      expect(() =>
        buildRedelegateMsg({
          delegatorAddress: OSMO_VAL,
          validatorSrcAddress: OSMO_VAL,
          validatorDstAddress: OSMO_VAL_2,
          amount: '1000000',
          denom: 'uosmo',
        })
      ).toThrow(/validator key, not a spendable account/)
    })

    it('rejects a valoper delegator on withdraw rewards (no prefix passed)', () => {
      expect(() =>
        buildWithdrawRewardsMsg({
          delegatorAddress: OSMO_VAL,
          validatorAddress: OSMO_VAL,
        })
      ).toThrow(/validator key, not a spendable account/)
    })

    it('rejects a plain ACCOUNT address handed in where a validator is required (no prefix passed)', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_DEL, // account in the validator slot
          amount: '5000000',
          denom: 'uosmo',
        })
      ).toThrow(/not a validator operator address/)
    })

    it('rejects an account address as the redelegate src/dst validator (no prefix passed)', () => {
      expect(() =>
        buildRedelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorSrcAddress: OSMO_DEL,
          validatorDstAddress: OSMO_VAL_2,
          amount: '1000000',
          denom: 'uosmo',
        })
      ).toThrow(/not a validator operator address/)
    })

    it('still accepts the correct account+valoper roles with NO prefixes (happy path unbroken)', () => {
      expect(() =>
        buildDelegateMsg({
          delegatorAddress: OSMO_DEL,
          validatorAddress: OSMO_VAL,
          amount: '5000000',
          denom: 'uosmo',
        })
      ).not.toThrow()
    })
  })
})
