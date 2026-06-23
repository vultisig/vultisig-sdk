import { decodeFunctionData, erc20Abi, getAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { buildThreeJaneSupplyUsdc, parseUsdcAmount, THREE_JANE_ADDRESSES } from '@/tools/defi/threeJane'

const FROM = '0x1111111111111111111111111111111111111111'
const RECEIVER = '0x2222222222222222222222222222222222222222'

const helperDepositAbi = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assets', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'hop', type: 'bool' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

describe('parseUsdcAmount', () => {
  it('parses whole and fractional USDC into 6-decimal raw', () => {
    expect(parseUsdcAmount('1000')).toBe(1_000_000_000n)
    expect(parseUsdcAmount('1500.5')).toBe(1_500_500_000n)
    expect(parseUsdcAmount('0.000001')).toBe(1n)
  })

  it('rejects bad input', () => {
    expect(() => parseUsdcAmount('')).toThrow()
    expect(() => parseUsdcAmount('-5')).toThrow()
    expect(() => parseUsdcAmount('1.2.3')).toThrow()
    expect(() => parseUsdcAmount('1.1234567')).toThrow(/too many decimal places/)
    expect(() => parseUsdcAmount('abc')).toThrow()
  })
})

describe('buildThreeJaneSupplyUsdc', () => {
  it('builds an unsigned [approve, deposit] sequence for the senior tranche', () => {
    const res = buildThreeJaneSupplyUsdc({ from: FROM, amount: '1000' })

    expect(res.chain).toBe('Ethereum')
    expect(res.chainId).toBe(1)
    expect(res.protocol).toBe('3Jane')
    expect(res.tranche).toBe('usd3')
    expect(res.toSymbol).toBe('USD3')
    expect(res.amountRaw).toBe('1000000000')
    expect(res.transactions).toHaveLength(2)

    const [approve, deposit] = res.transactions

    // step 1: ERC-20 approve to the helper for the exact amount
    expect(approve.action).toBe('approve')
    expect(approve.value).toBe('0')
    expect(getAddress(approve.to)).toBe(getAddress(THREE_JANE_ADDRESSES.usdc))
    const approveDecoded = decodeFunctionData({ abi: erc20Abi, data: approve.data })
    expect(approveDecoded.functionName).toBe('approve')
    expect(getAddress(approveDecoded.args[0] as string)).toBe(getAddress(THREE_JANE_ADDRESSES.helper))
    expect(approveDecoded.args[1]).toBe(1_000_000_000n)

    // step 2: Helper.deposit(assets, receiver=from, hop=false)
    expect(deposit.action).toBe('deposit')
    expect(getAddress(deposit.to)).toBe(getAddress(THREE_JANE_ADDRESSES.helper))
    const depositDecoded = decodeFunctionData({ abi: helperDepositAbi, data: deposit.data })
    expect(depositDecoded.functionName).toBe('deposit')
    expect(depositDecoded.args[0]).toBe(1_000_000_000n)
    expect(getAddress(depositDecoded.args[1] as string)).toBe(getAddress(FROM))
    expect(depositDecoded.args[2]).toBe(false)
  })

  it('sets hop=true and mints sUSD3 for the staked junior tranche', () => {
    const res = buildThreeJaneSupplyUsdc({ from: FROM, amount: '2000', tranche: 'susd3' })
    expect(res.toSymbol).toBe('sUSD3')
    const depositDecoded = decodeFunctionData({ abi: helperDepositAbi, data: res.transactions[1].data })
    expect(depositDecoded.args[2]).toBe(true)
  })

  it('routes shares to an injectable receiver distinct from the funder', () => {
    const res = buildThreeJaneSupplyUsdc({ from: FROM, amount: '1000', receiver: RECEIVER })
    expect(getAddress(res.receiver)).toBe(getAddress(RECEIVER))
    expect(getAddress(res.fromAddress)).toBe(getAddress(FROM))
    const depositDecoded = decodeFunctionData({ abi: helperDepositAbi, data: res.transactions[1].data })
    expect(getAddress(depositDecoded.args[1] as string)).toBe(getAddress(RECEIVER))
  })

  it('defaults receiver to the funder (neutral / self-only)', () => {
    const res = buildThreeJaneSupplyUsdc({ from: FROM, amount: '1000' })
    expect(getAddress(res.receiver)).toBe(getAddress(FROM))
  })

  it('enforces the 1,000 USDC minimum deposit', () => {
    expect(() => buildThreeJaneSupplyUsdc({ from: FROM, amount: '999' })).toThrow(/at least 1000 USDC/)
  })

  it('rejects an invalid from / receiver address', () => {
    expect(() => buildThreeJaneSupplyUsdc({ from: 'nope', amount: '1000' })).toThrow(/invalid "from"/)
    expect(() => buildThreeJaneSupplyUsdc({ from: FROM, amount: '1000', receiver: 'nope' })).toThrow(
      /invalid "receiver"/
    )
  })

  it('does not hardcode any affiliate / station recipient', () => {
    const res = buildThreeJaneSupplyUsdc({ from: FROM, amount: '5000' })
    const serialized = JSON.stringify(res).toLowerCase()
    expect(serialized).not.toContain('station')
    expect(serialized).not.toContain('affiliate')
  })
})
