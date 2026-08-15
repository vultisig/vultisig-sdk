import { describe, expect, it } from 'vitest'

import {
  acrossQuote,
  balance,
  bridge,
  buildCctpBridge,
  compareCosts,
  cosmos,
  decode,
  decodeEvmTx,
  findSwapQuote,
  gas,
  getCosmosGovernanceProposals,
  getEvmBalances,
  getPrice,
  prep,
  prepareSendTxFromKeys,
  price,
  swap,
} from '@/index'
import {
  balance as balanceFromTools,
  bridge as bridgeFromTools,
  decode as decodeFromTools,
  gas as gasFromTools,
  prep as prepFromTools,
  price as priceFromTools,
  swap as swapFromTools,
} from '@/tools'

// Regression coverage for #1912: the root/module exports for these helper
// families existed, but `new Vultisig()` never exposed matching instance
// namespaces (covered separately in Vultisig.test.ts). This file locks down
// that the ROOT namespace objects themselves delegate to the canonical flat
// implementations rather than reimplementing anything.
describe('SDK root namespace exports (#1912)', () => {
  it('exposes the balance helper family without removing flat exports', () => {
    expect(balance).toBe(balanceFromTools)
    expect(balance.getEvmBalances).toBe(getEvmBalances)
  })

  it('exposes the bridge helper family without removing flat exports', () => {
    expect(bridge).toBe(bridgeFromTools)
    expect(bridge.buildCctpBridge).toBe(buildCctpBridge)
  })

  it('exposes Cosmos governance under sdk.cosmos.gov (already wired, unaffected by #1912)', () => {
    expect(cosmos.gov.getCosmosGovernanceProposals).toBe(getCosmosGovernanceProposals)
  })

  it('exposes the decode helper family without removing flat exports', () => {
    expect(decode).toBe(decodeFromTools)
    expect(decode.decodeEvmTx).toBe(decodeEvmTx)
  })

  it('exposes the gas helper family without removing flat exports', () => {
    expect(gas).toBe(gasFromTools)
    expect(gas.compareCosts).toBe(compareCosts)
  })

  it('exposes the prep helper family without removing flat exports', () => {
    expect(prep).toBe(prepFromTools)
    expect(prep.prepareSendTxFromKeys).toBe(prepareSendTxFromKeys)
  })

  it('exposes the price helper family without removing flat exports', () => {
    expect(price).toBe(priceFromTools)
    expect(price.getPrice).toBe(getPrice)
  })

  it('exposes the swap helper family without removing flat exports', () => {
    expect(swap).toBe(swapFromTools)
    expect(swap.findSwapQuote).toBe(findSwapQuote)
    expect(swap.acrossQuote).toBe(acrossQuote)
  })
})
