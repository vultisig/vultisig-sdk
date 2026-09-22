import { describe, expect, it, vi } from 'vitest'

// Match the partial fee configuration used by SwapService consumers.
// Do not mock the prep barrel or its builders: their eager imports are the regression.
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: {
    Ethereum: { ticker: 'ETH', decimals: 18 },
    Bitcoin: { ticker: 'BTC', decimals: 8 },
    BSC: { ticker: 'BNB', decimals: 18 },
    Polygon: { ticker: 'MATIC', decimals: 18 },
    THORChain: { ticker: 'RUNE', decimals: 8 },
    MayaChain: { ticker: 'CACAO', decimals: 10 },
    Avalanche: { ticker: 'AVAX', decimals: 18 },
    Base: { ticker: 'ETH', decimals: 18 },
    Arbitrum: { ticker: 'ETH', decimals: 18 },
    Solana: { ticker: 'SOL', decimals: 9 },
    Cosmos: { ticker: 'ATOM', decimals: 6 },
    Hyperliquid: { ticker: 'HYPE', decimals: 18 },
    Optimism: { ticker: 'ETH', decimals: 18 },
    Robinhood: { ticker: 'ETH', decimals: 18 },
  },
}))

describe('prep import isolation', () => {
  it('imports the complete canonical barrel with a partial fee configuration', async () => {
    const prep = await import('../../../../src/tools/prep')
    expect(prep.prepareSignAminoTxFromKeys).toBeTypeOf('function')
    expect(prep.prepareSignDirectTxFromKeys).toBeTypeOf('function')
    expect(prep.prepareSendTxFromKeys).toBeTypeOf('function')
    expect(prep.prepareSwapTxFromKeys).toBeTypeOf('function')
    expect(prep.getMaxSendAmountFromKeys).toBeTypeOf('function')
  })
})
