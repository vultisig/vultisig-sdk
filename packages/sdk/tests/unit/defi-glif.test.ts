import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  GLIF_ICN_BASE_ADDRESSES,
  glifPoolWriteAbi,
} from '../../src/defi/glif'

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
  })
})
