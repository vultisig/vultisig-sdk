import { Chain } from '@vultisig/core-chain/Chain'
import { knownTokens, knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { describe, expect, it } from 'vitest'

// QA-SWAP-2 (runtime QA 2026-06-15): the knownTokens fast-path registry was
// missing Circle USDC on Base, the only major-EVM canonical USDC absent.
// Swaps to Base USDC fell through to the CoinGecko source, so resolveToken
// emitted `source: coingecko` and the app flagged the canonical stablecoin
// as "unverified token -- confirm this is the token you want". Same class of
// bug as the Solana SPL fast-path gap (Bug J). This suite pins Base USDC so
// it resolves as a known token (verified) and survives future refactors.
//
// Address is public, canonical, native CCTP issuance (not bridged):
//   USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (Circle)

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

describe('knownTokens — Base USDC fast-path (QA-SWAP-2)', () => {
  it('is reachable via knownTokensIndex (the canonical lookup API)', () => {
    const fromIndex = knownTokensIndex[Chain.Base][BASE_USDC.toLowerCase()]
    expect(fromIndex).toBeDefined()
    expect(fromIndex.ticker).toBe('USDC')
    expect(fromIndex.decimals).toBe(6)
    expect(fromIndex.priceProviderId).toBe('usd-coin')
  })

  it('appears in the knownTokens[Base] array', () => {
    const usdc = knownTokens[Chain.Base].find(c => c.id === BASE_USDC)
    expect(usdc).toBeDefined()
    expect(usdc!.ticker).toBe('USDC')
    expect(usdc!.decimals).toBe(6)
  })
})
