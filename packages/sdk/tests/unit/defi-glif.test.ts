import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  GLIF_ICN_BASE_ADDRESSES,
  glifPoolWriteAbi,
} from '../../src/tools/defi/glif'

const FROM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const RECEIVER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const ONE = 10n ** 18n // 1 token in 18-decimal base units

describe('sdk.defi.glif — buildGlifStakeIcnt', () => {
  it('builds [approve, deposit] when allowance is insufficient and decodes to the right args', () => {
    const res = buildGlifStakeIcnt({ from: FROM, amount: ONE })

    expect(res.action).toBe('glif_stake_icnt')
    expect(res.chainId).toBe(8453)
    expect(res.approvalRequired).toBe(true)
    expect(res.transactions).toHaveLength(2)

    const [approve, deposit] = res.transactions

    // approve(pool, amount) on the ICNT token
    expect(approve.action).toBe('approve')
    expect(getAddress(approve.to)).toBe(GLIF_ICN_BASE_ADDRESSES.icnt)
    const approveDecoded = decodeFunctionData({ abi: erc20Abi, data: approve.data })
    expect(approveDecoded.functionName).toBe('approve')
    expect(getAddress(approveDecoded.args[0] as string)).toBe(GLIF_ICN_BASE_ADDRESSES.pool)
    expect(approveDecoded.args[1]).toBe(ONE)

    // deposit(amount, receiver=from) on the pool
    expect(deposit.action).toBe('deposit')
    expect(getAddress(deposit.to)).toBe(GLIF_ICN_BASE_ADDRESSES.pool)
    const depositDecoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: deposit.data })
    expect(depositDecoded.functionName).toBe('deposit')
    expect(depositDecoded.args[0]).toBe(ONE)
    expect(getAddress(depositDecoded.args[1] as string)).toBe(getAddress(FROM))
  })

  it('drops the approve step when allowance already covers the amount', () => {
    const res = buildGlifStakeIcnt({ from: FROM, amount: ONE, currentAllowance: ONE })
    expect(res.approvalRequired).toBe(false)
    expect(res.transactions).toHaveLength(1)
    expect(res.transactions[0].action).toBe('deposit')
  })

  it('honors an INJECTABLE receiver (defaults to from, never hardcoded)', () => {
    const res = buildGlifStakeIcnt({ from: FROM, amount: ONE, receiver: RECEIVER, currentAllowance: ONE })
    const decoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: res.transactions[0].data })
    expect(getAddress(decoded.args[1] as string)).toBe(getAddress(RECEIVER))
    expect(res.receiver).toBe(getAddress(RECEIVER))
  })

  it('rejects non-positive, overflowing, and invalid inputs', () => {
    expect(() => buildGlifStakeIcnt({ from: FROM, amount: 0n })).toThrow(/positive/)
    expect(() => buildGlifStakeIcnt({ from: FROM, amount: -1n })).toThrow(/positive/)
    expect(() => buildGlifStakeIcnt({ from: FROM, amount: 1n << 256n })).toThrow(/overflows uint256/)
    expect(() => buildGlifStakeIcnt({ from: 'not-an-address', amount: ONE })).toThrow(/invalid address/)
  })
})

describe('sdk.defi.glif — buildGlifRedeemSticnt', () => {
  it('builds a single redeem(shares, receiver, owner) tx with owner pinned to from', () => {
    const res = buildGlifRedeemSticnt({ from: FROM, amount: ONE })
    expect(res.action).toBe('glif_redeem_sticnt')
    expect(res.transactions).toHaveLength(1)

    const [redeem] = res.transactions
    expect(redeem.action).toBe('redeem')
    expect(getAddress(redeem.to)).toBe(GLIF_ICN_BASE_ADDRESSES.pool)

    const decoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: redeem.data })
    expect(decoded.functionName).toBe('redeem')
    expect(decoded.args[0]).toBe(ONE) // shares
    expect(getAddress(decoded.args[1] as string)).toBe(getAddress(FROM)) // receiver default
    expect(getAddress(decoded.args[2] as string)).toBe(getAddress(FROM)) // owner always = from
  })

  it('routes redeemed ICNT to an injected receiver while keeping owner = from', () => {
    const res = buildGlifRedeemSticnt({ from: FROM, amount: ONE, receiver: RECEIVER })
    const decoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: res.transactions[0].data })
    expect(getAddress(decoded.args[1] as string)).toBe(getAddress(RECEIVER)) // receiver injected
    expect(getAddress(decoded.args[2] as string)).toBe(getAddress(FROM)) // owner stays from
  })

  it('rejects bad amounts', () => {
    expect(() => buildGlifRedeemSticnt({ from: FROM, amount: 0n })).toThrow(/positive/)
    expect(() => buildGlifRedeemSticnt({ from: FROM, amount: 1n << 256n })).toThrow(/overflows uint256/)
    expect(() => buildGlifRedeemSticnt({ from: 'nope', amount: ONE })).toThrow(/invalid address/)
  })
})

describe('sdk.defi.glif — canonical Base addresses (literal pin, #228 inert-guard guard)', () => {
  // The other suites assert `encoded == GLIF_ICN_BASE_ADDRESSES.*`, which stays
  // green even if the constant itself is corrupted (the expectation moves with
  // the symbol). Pin the LITERAL canonical Base addresses so a fat-fingered
  // pool/token constant — the single most fund-critical value here — fails CI.
  // Verified on-chain (Base 8453): pool.asset() == ICNT, pool.symbol() == stICNT.
  it('pins ICNT token + stICNT pool to their on-chain-verified Base addresses', () => {
    expect(GLIF_ICN_BASE_ADDRESSES.icnt).toBe(getAddress('0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d'))
    expect(GLIF_ICN_BASE_ADDRESSES.pool).toBe(getAddress('0xAeD7C2eD7Bb84396AfCB55fF72c8F8E87FFb68f3'))
  })

  it('stake encodes the LITERAL pool as approve-spender + deposit-target (not just the symbol)', () => {
    const res = buildGlifStakeIcnt({ from: FROM, amount: ONE })
    const approve = decodeFunctionData({ abi: erc20Abi, data: res.transactions[0].data })
    // approve target == literal ICNT token; spender == literal pool
    expect(getAddress(res.transactions[0].to)).toBe(getAddress('0xE0Cd4cAcDdcBF4f36e845407CE53E87717b6601d'))
    expect(getAddress(approve.args[0] as string)).toBe(getAddress('0xAeD7C2eD7Bb84396AfCB55fF72c8F8E87FFb68f3'))
    // deposit target == literal pool
    expect(getAddress(res.transactions[1].to)).toBe(getAddress('0xAeD7C2eD7Bb84396AfCB55fF72c8F8E87FFb68f3'))
  })

  it('redeem encodes the LITERAL pool as the target (not just the symbol)', () => {
    const res = buildGlifRedeemSticnt({ from: FROM, amount: ONE })
    expect(getAddress(res.transactions[0].to)).toBe(getAddress('0xAeD7C2eD7Bb84396AfCB55fF72c8F8E87FFb68f3'))
  })
})

describe('sdk.defi.glif — fund-safety invariants (encoding == reported)', () => {
  // The crypto-in-SDK hotspot: the bytes handed to the signer MUST equal the
  // amount/owner/receiver the result object reports. No silent re-encode.
  it('stake: encoded deposit amount == reported amount, receiver == reported receiver', () => {
    const amount = 123456789012345678901n // arbitrary non-round 18-decimal value
    const res = buildGlifStakeIcnt({ from: FROM, amount, currentAllowance: amount })
    expect(res.amount).toBe(amount)
    const decoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: res.transactions[0].data })
    expect(decoded.functionName).toBe('deposit')
    expect(decoded.args[0]).toBe(amount) // exact uint256, no truncation/wrap
    expect(getAddress(decoded.args[1] as string)).toBe(res.receiver)
  })

  it('stake: approve amount == deposit amount (no allowance/deposit drift)', () => {
    const amount = 7n * ONE + 1n
    const res = buildGlifStakeIcnt({ from: FROM, amount })
    const approve = decodeFunctionData({ abi: erc20Abi, data: res.transactions[0].data })
    const deposit = decodeFunctionData({ abi: glifPoolWriteAbi, data: res.transactions[1].data })
    expect(approve.functionName).toBe('approve')
    expect(approve.args[1]).toBe(amount)
    expect(deposit.args[0]).toBe(amount)
    // approve spender is pinned to the pool, never caller-injectable
    expect(getAddress(approve.args[0] as string)).toBe(GLIF_ICN_BASE_ADDRESSES.pool)
  })

  it('redeem: encoded shares == reported amount, owner pinned to from regardless of receiver', () => {
    const amount = 98765432109876543210n
    const res = buildGlifRedeemSticnt({ from: FROM, amount, receiver: RECEIVER })
    expect(res.amount).toBe(amount)
    const decoded = decodeFunctionData({ abi: glifPoolWriteAbi, data: res.transactions[0].data })
    expect(decoded.args[0]).toBe(amount)
    expect(getAddress(decoded.args[1] as string)).toBe(getAddress(RECEIVER)) // receiver injectable
    expect(getAddress(decoded.args[2] as string)).toBe(getAddress(FROM)) // owner can NEVER be the injected receiver
  })

  it('selectors are pinned (deposit/redeem/approve) — wrong-selector regression guard', () => {
    const stake = buildGlifStakeIcnt({ from: FROM, amount: ONE })
    expect(stake.transactions[0].data.slice(0, 10)).toBe('0x095ea7b3') // approve(address,uint256)
    expect(stake.transactions[1].data.slice(0, 10)).toBe('0x6e553f65') // deposit(uint256,address)
    const redeem = buildGlifRedeemSticnt({ from: FROM, amount: ONE })
    expect(redeem.transactions[0].data.slice(0, 10)).toBe('0xba087652') // redeem(uint256,address,address)
  })

  it('targets/value are pinned to Base GLIF contracts with zero native value (no wrong-chain/target)', () => {
    const stake = buildGlifStakeIcnt({ from: FROM, amount: ONE })
    expect(stake.chainId).toBe(8453)
    expect(getAddress(stake.transactions[0].to)).toBe(GLIF_ICN_BASE_ADDRESSES.icnt) // approve target = token
    expect(getAddress(stake.transactions[1].to)).toBe(GLIF_ICN_BASE_ADDRESSES.pool) // deposit target = pool
    expect(stake.transactions.every(t => t.value === '0')).toBe(true)
  })
})
