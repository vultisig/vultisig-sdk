import { CosmosChain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  COSMOS_MEMO_DEFAULT_MAX_BYTES,
  getCosmosMemoMaxBytes,
  getCosmosMemoMaxBytesByChainId,
  isCosmosMemoWithinCap,
} from './cosmosMemoCap'

describe('getCosmosMemoMaxBytes', () => {
  it('returns the live-verified gov-raised override for Terra v2 and Cosmos Hub', () => {
    expect(getCosmosMemoMaxBytes(CosmosChain.Terra)).toBe(512)
    expect(getCosmosMemoMaxBytes(CosmosChain.Cosmos)).toBe(512)
  })

  it('returns the sdk default (256) for every other cosmos chain, including TerraClassic', () => {
    for (const chain of [
      CosmosChain.TerraClassic,
      CosmosChain.Osmosis,
      CosmosChain.Kujira,
      CosmosChain.Noble,
      CosmosChain.Dydx,
      CosmosChain.Akash,
      CosmosChain.THORChain,
      CosmosChain.MayaChain,
    ]) {
      expect(getCosmosMemoMaxBytes(chain)).toBe(COSMOS_MEMO_DEFAULT_MAX_BYTES)
    }
  })
})

describe('getCosmosMemoMaxBytesByChainId', () => {
  it('resolves the same cap as getCosmosMemoMaxBytes via the chain-id string', () => {
    expect(getCosmosMemoMaxBytesByChainId('phoenix-1')).toBe(512)
    expect(getCosmosMemoMaxBytesByChainId('cosmoshub-4')).toBe(512)
    expect(getCosmosMemoMaxBytesByChainId('columbus-5')).toBe(256)
    expect(getCosmosMemoMaxBytesByChainId('osmosis-1')).toBe(256)
    expect(getCosmosMemoMaxBytesByChainId('kaiyo-1')).toBe(256)
    expect(getCosmosMemoMaxBytesByChainId('noble-1')).toBe(256)
  })

  it('fails closed to the sdk default for an unrecognized chain-id rather than skipping the check', () => {
    expect(getCosmosMemoMaxBytesByChainId('not-a-real-chain-id')).toBe(COSMOS_MEMO_DEFAULT_MAX_BYTES)
  })
})

describe('isCosmosMemoWithinCap', () => {
  it('is true for a memo at or under the cap, false one byte over', () => {
    const exactly256 = 'a'.repeat(256)
    const over256 = 'a'.repeat(257)
    expect(isCosmosMemoWithinCap(CosmosChain.TerraClassic, exactly256)).toBe(true)
    expect(isCosmosMemoWithinCap(CosmosChain.TerraClassic, over256)).toBe(false)
  })

  it('uses the chain-specific override, not a hardcoded 256, for Terra v2 / Cosmos Hub', () => {
    // 300 bytes: over TerraClassic's 256 cap, under Terra v2 / Cosmos Hub's 512 cap.
    const memo300 = 'a'.repeat(300)
    expect(isCosmosMemoWithinCap(CosmosChain.TerraClassic, memo300)).toBe(false)
    expect(isCosmosMemoWithinCap(CosmosChain.Terra, memo300)).toBe(true)
    expect(isCosmosMemoWithinCap(CosmosChain.Cosmos, memo300)).toBe(true)
  })

  it('counts UTF-8 bytes, not JS string length (multi-byte characters)', () => {
    // Each '🚀' is 4 UTF-8 bytes but 2 UTF-16 code units (.length counts as 2) -
    // a naive .length check would under-count and let an over-cap memo through.
    const emojiMemo = '🚀'.repeat(65) // 260 bytes, over TerraClassic's 256 cap
    expect(emojiMemo.length).toBeLessThan(260)
    expect(isCosmosMemoWithinCap(CosmosChain.TerraClassic, emojiMemo)).toBe(false)
  })
})
