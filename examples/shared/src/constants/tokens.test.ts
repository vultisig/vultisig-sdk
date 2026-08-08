import { describe, expect, it } from 'vitest'

import { COMMON_TOKENS, isValidEvmContractAddress } from './tokens'

describe('COMMON_TOKENS', () => {
  it('ships only valid EVM contract addresses for suggested tokens', () => {
    for (const [chain, tokens] of Object.entries(COMMON_TOKENS)) {
      for (const token of tokens) {
        expect(
          isValidEvmContractAddress(token.contractAddress),
          `${chain} ${token.symbol} should expose a valid EVM address`,
        ).toBe(true)
      }
    }
  })

  it('pins Ethereum DAI to the canonical mainnet contract', () => {
    const dai = COMMON_TOKENS.Ethereum?.find((token) => token.symbol === 'DAI')
    expect(dai?.contractAddress).toBe('0x6B175474E89094C44Da98b954EedeAC495271d0F')
  })
})
