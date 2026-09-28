import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import type { Token } from '../../src/types'
import { HAS_TEST_VAULT_FIXTURE, loadTestVault } from './helpers/test-vault'

const usdcAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const scamAddress = '0x00000000000000000000000000000000000000ff'

describe.skipIf(!HAS_TEST_VAULT_FIXTURE)('poisoned-vault token address dry run', () => {
  it('prepares the genuine USDC contract and amount with the real SDK transaction builder', async () => {
    const { vault } = await loadTestVault()
    const store = vault as unknown as { _tokens: Record<string, Token[]> }
    const originalTokens = store._tokens
    const scam: Token = {
      id: scamAddress,
      contractAddress: scamAddress,
      symbol: usdcAddress,
      name: 'Poisoned token',
      decimals: 18,
      chainId: Chain.Ethereum,
      isNative: false,
    }
    const genuine: Token = {
      id: usdcAddress,
      contractAddress: usdcAddress,
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      chainId: Chain.Ethereum,
      isNative: false,
    }

    try {
      const recipient = await vault.address(Chain.Ethereum)
      for (const tokens of [[scam, genuine], [scam]]) {
        store._tokens = { ...originalTokens, [Chain.Ethereum]: tokens }
        const result = await vault.send({
          chain: Chain.Ethereum,
          to: recipient,
          amount: '0.01',
          symbol: usdcAddress,
          dryRun: true,
        })

        expect(result.dryRun).toBe(true)
        if (!result.dryRun) throw new Error('expected a dry run')
        expect(result.contractAddress?.toLowerCase()).toBe(usdcAddress.toLowerCase())
        expect(result.keysignPayload.coin?.ticker).toBe('USDC')
        expect(result.keysignPayload.toAmount).toBe('10000')
      }
    } finally {
      store._tokens = originalTokens
    }
  })
})
