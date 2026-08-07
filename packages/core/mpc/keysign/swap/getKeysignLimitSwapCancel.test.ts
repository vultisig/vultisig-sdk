import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getKeysignLimitSwapCancel } from './getKeysignLimitSwapCancel'

const fullUsdc = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'
const memo = `m=<:100000000THOR.RUNE:43079145${fullUsdc}:0`

describe('getKeysignLimitSwapCancel', () => {
  it('decodes the order a cancel memo addresses', () => {
    expect(getKeysignLimitSwapCancel({ memo })).toEqual({
      sourceAsset: 'THOR.RUNE',
      sourceAmount: 100_000_000n,
      sourceAmountDecimal: '1.00000000',
      sourceChain: Chain.THORChain,
      targetAsset: fullUsdc,
      tradeTarget: 43_079_145n,
      tradeTargetDecimal: '0.43079145',
      targetChain: Chain.Ethereum,
      bucketKey: 'THOR.RUNE>ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48/000000000232130883/',
    })
  })

  // The whole point of reading the memo: a cancel carries no swap payload on any
  // branch, so a co-signer keying off one sees a dust send to an opaque address.
  it('decodes an L1-sourced cancel just as well as a THORChain-sourced one', () => {
    expect(getKeysignLimitSwapCancel({ memo: 'm=<:250000000BTC.BTC:5000000000THOR.RUNE:0' })).toMatchObject({
      sourceChain: Chain.Bitcoin,
      sourceAmountDecimal: '2.50000000',
      targetChain: Chain.THORChain,
      tradeTargetDecimal: '50.00000000',
    })
  })

  // A secured asset spells its whole denom with `-`, so splitting on `.` alone
  // would resolve no chain at all.
  it('resolves the home chain of a secured asset', () => {
    const cancel = getKeysignLimitSwapCancel({
      memo: 'm=<:100000000eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48:5000000THOR.RUNE:0',
    })

    expect(cancel?.sourceChain).toBe(Chain.Ethereum)
  })

  // Reporting a retarget as a cancellation would show a reviewer the opposite of
  // what they are approving.
  it('does not report a retarget as a cancellation', () => {
    expect(getKeysignLimitSwapCancel({ memo: `m=<:100000000THOR.RUNE:43079145${fullUsdc}:50000000` })).toBeUndefined()
  })

  it.each([
    [`=<:ETH.ETH:0xdest:100/14400/0`, 'a placement'],
    ['=>:ETH.ETH:0xdest:100', 'a market swap'],
    ['+:BTC.BTC', 'an LP add'],
    ['', 'an empty memo'],
    [undefined, 'no memo'],
  ])('returns undefined for %s', (value: string | undefined, _label: string) => {
    expect(getKeysignLimitSwapCancel({ memo: value as string })).toBeUndefined()
  })

  // A reviewer wants "not a cancellation" rather than a throw when handed an
  // arbitrary payload; signing still rejects it.
  it('reports a malformed cancel memo as not-a-cancellation rather than throwing', () => {
    expect(getKeysignLimitSwapCancel({ memo: 'm=<:THOR.RUNE:43079145ETH.ETH:0' })).toBeUndefined()
    expect(getKeysignLimitSwapCancel({ memo: 'm=<:0THOR.RUNE:43079145ETH.ETH:0' })).toBeUndefined()
    expect(getKeysignLimitSwapCancel({ memo: 'm=<:100THOR.RUNE:0' })).toBeUndefined()
  })
})
