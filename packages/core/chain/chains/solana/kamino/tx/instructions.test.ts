import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  anchorU64Argument,
  anchorU128Argument,
  computeUnitLimitArgument,
  computeUnitPriceArgument,
  deriveKaminoFarmsUserState,
  hasNoAnchorArgument,
  isAttributionMemoData,
  kaminoAttributionMemoTag,
  kaminoAttributionMemoTagBytes,
  kaminoDiscriminators,
  systemTransferLamports,
} from './instructions'

describe('kaminoAttributionMemoTag', () => {
  it('pins the exact literal and its exact bytes', () => {
    // The tag is the filter every downstream attribution measurement keys on
    // and must be byte-identical on every platform. Changing it is a
    // coordinated, deliberate act — this test is the tripwire.
    expect(kaminoAttributionMemoTag).toBe('8k2mz')
    expect(Array.from(kaminoAttributionMemoTagBytes)).toEqual([0x38, 0x6b, 0x32, 0x6d, 0x7a])
  })

  it('matches the tag whole and case-sensitively', () => {
    const encode = (text: string) => new TextEncoder().encode(text)
    expect(isAttributionMemoData(encode('8k2mz'))).toBe(true)
    expect(isAttributionMemoData(encode('8K2MZ'))).toBe(false)
    expect(isAttributionMemoData(encode('8k2mz '))).toBe(false)
    expect(isAttributionMemoData(encode(' 8k2mz'))).toBe(false)
    expect(isAttributionMemoData(encode('8k2m'))).toBe(false)
    expect(isAttributionMemoData(encode('8k2mzz'))).toBe(false)
    expect(isAttributionMemoData(encode(''))).toBe(false)
  })
})

describe('kaminoDiscriminators', () => {
  it('every Anchor discriminator derives from its instruction name', () => {
    // A constant copied out of a captured transaction matches the shape it
    // was copied from and asserts nothing; one derived from the name and then
    // found in the bytes says the bytes are that instruction.
    const anchor = (name: string) => Array.from(createHash('sha256').update(`global:${name}`).digest().subarray(0, 8))

    expect(Array.from(kaminoDiscriminators.kvaultDeposit)).toEqual(anchor('deposit'))
    expect(Array.from(kaminoDiscriminators.kvaultWithdraw)).toEqual(anchor('withdraw'))
    expect(Array.from(kaminoDiscriminators.kvaultWithdrawFromAvailable)).toEqual(anchor('withdraw_from_available'))
    expect(Array.from(kaminoDiscriminators.farmsInitializeUser)).toEqual(anchor('initialize_user'))
    expect(Array.from(kaminoDiscriminators.farmsStake)).toEqual(anchor('stake'))
    expect(Array.from(kaminoDiscriminators.farmsUnstake)).toEqual(anchor('unstake'))
    expect(Array.from(kaminoDiscriminators.farmsWithdrawUnstakedDeposits)).toEqual(anchor('withdraw_unstaked_deposits'))
  })
})

describe('argument readers', () => {
  const disc = kaminoDiscriminators.kvaultDeposit

  it('reads a u64 argument little-endian, keyed on exact length', () => {
    const data = Uint8Array.from([...disc, 0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00])
    expect(anchorU64Argument(data)).toBe(1_000_000n)
    // A u128 payload must not be readable through the u64 reader: it would
    // take the low 8 bytes of a 16-byte field and report a plausible-looking
    // number that is not the one on the wire.
    expect(anchorU64Argument(Uint8Array.from([...disc, ...new Array(16).fill(1)]))).toBeUndefined()
    expect(anchorU64Argument(disc)).toBeUndefined()
  })

  it('reads a u128 argument exactly, keyed on exact length', () => {
    // 1 share base unit at the farms 10^18 stake scale.
    const scaled = 10n ** 18n
    const bytes = new Uint8Array(16)
    let value = scaled
    for (let index = 0; index < 16; index++) {
      bytes[index] = Number(value & 0xffn)
      value >>= 8n
    }
    expect(anchorU128Argument(Uint8Array.from([...kaminoDiscriminators.farmsUnstake, ...bytes]))).toBe(scaled)
    expect(
      anchorU128Argument(Uint8Array.from([...kaminoDiscriminators.farmsUnstake, ...bytes.slice(0, 8)]))
    ).toBeUndefined()
  })

  it('recognises an argumentless payload only when nothing trails', () => {
    expect(hasNoAnchorArgument(kaminoDiscriminators.farmsWithdrawUnstakedDeposits)).toBe(true)
    expect(hasNoAnchorArgument(Uint8Array.from([...kaminoDiscriminators.farmsWithdrawUnstakedDeposits, 0]))).toBe(false)
  })

  it('reads compute budget and system transfer arguments at exact sizes', () => {
    expect(computeUnitLimitArgument(Uint8Array.from([2, 0x00, 0xe2, 0x04, 0x00]))).toBe(320_000)
    expect(computeUnitPriceArgument(Uint8Array.from([3, 0x20, 0x4e, 0, 0, 0, 0, 0, 0]))).toBe(20_000n)
    expect(computeUnitLimitArgument(Uint8Array.from([3, 0, 0, 0, 0]))).toBeUndefined()
    expect(systemTransferLamports(Uint8Array.from([2, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]))).toBe(1_000_000n)
    expect(systemTransferLamports(Uint8Array.from([3, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]))).toBeUndefined()
  })
})

describe('deriveKaminoFarmsUserState', () => {
  it('derives a deterministic program address and refuses malformed keys', () => {
    const farm = '9FVjHqduhDPMVqvu3cXiEBjU6nvxvGdCCLRwd9WpVRZj'
    const owner = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    const derived = deriveKaminoFarmsUserState({ farm, owner })
    expect(derived).toBeDefined()
    expect(deriveKaminoFarmsUserState({ farm, owner })).toBe(derived)
    expect(deriveKaminoFarmsUserState({ farm: 'not-a-key', owner })).toBeUndefined()
  })
})
