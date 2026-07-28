import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import { getKeysignLimitSwapOrder } from './getKeysignLimitSwapOrder'

const evmAddress = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
const memo = `=<:ETH.USDC-06EB48:${evmAddress}:43079145/14400/0:v0:50`

describe('getKeysignLimitSwapOrder', () => {
  it('decodes the order terms a limit memo encodes', () => {
    expect(getKeysignLimitSwapOrder({ memo })).toEqual({
      targetAsset: 'ETH.USDC-06EB48',
      targetChain: Chain.Ethereum,
      destinationAddress: evmAddress,
      limit: 43_079_145n,
      minimumReceivedDecimal: '0.43079145',
      intervalBlocks: 14_400,
      expiryHours: 24,
      quantity: 0,
      affiliate: 'v0',
      affiliateBps: 50,
    })
  })

  // The whole point of reading the memo: it works for RUNE and native-gas
  // sources too, which carry no swap payload for a co-signer to key off.
  it('decodes an order regardless of the source branch', () => {
    const runeSourced = `=<:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh:5000/7200/0`

    expect(getKeysignLimitSwapOrder({ memo: runeSourced })).toMatchObject({
      targetAsset: 'BTC.BTC',
      targetChain: Chain.Bitcoin,
      limit: 5_000n,
      minimumReceivedDecimal: '0.00005000',
      expiryHours: 12,
    })
  })

  it('omits the affiliate fields when the memo carries none', () => {
    const order = getKeysignLimitSwapOrder({ memo: `=<:ETH.ETH:${evmAddress}:100/14400/0` })

    expect(order?.affiliate).toBeUndefined()
    expect(order?.affiliateBps).toBeUndefined()
  })

  it.each([
    ['a market swap memo', `=>:ETH.ETH:${evmAddress}:100/14400/0`],
    ['a plain send', 'hello'],
    ['an empty memo', ''],
    ['no memo at all', undefined],
  ])('returns undefined for %s', (_label, value) => {
    expect(getKeysignLimitSwapOrder({ memo: value })).toBeUndefined()
  })

  // A caller reviewing an arbitrary payload wants "not a limit order" rather
  // than a throw. Signing still rejects these — the builder parses the same memo.
  it.each([
    ['a zero LIM', `=<:ETH.ETH:${evmAddress}:0/14400/0`],
    ['a missing trade target', `=<:ETH.ETH:${evmAddress}`],
    ['a non-numeric LIM', `=<:ETH.ETH:${evmAddress}:abc/14400/0`],
    ['an empty destination', '=<:ETH.ETH::100/14400/0'],
  ])('reports %s as not a limit order rather than throwing', (_label, value) => {
    expect(getKeysignLimitSwapOrder({ memo: value })).toBeUndefined()
  })

  it('leaves the target chain undefined for an unroutable asset prefix', () => {
    const order = getKeysignLimitSwapOrder({ memo: `=<:XYZ.XYZ:${evmAddress}:100/14400/0` })

    expect(order?.targetAsset).toBe('XYZ.XYZ')
    expect(order?.targetChain).toBeUndefined()
  })

  it('leaves expiry undefined for an interval this SDK does not build', () => {
    expect(getKeysignLimitSwapOrder({ memo: `=<:ETH.ETH:${evmAddress}:100/999/0` })?.expiryHours).toBeUndefined()
  })
})
