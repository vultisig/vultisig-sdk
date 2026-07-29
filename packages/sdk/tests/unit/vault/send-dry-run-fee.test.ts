import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import type { SendResult, Token } from '../../../src/types'
import { VaultBase } from '../../../src/vault/VaultBase'

const USDC_LOWER = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const storedUsdc: Token = {
  id: USDC_LOWER,
  symbol: 'USDC',
  name: 'USDC',
  decimals: 6,
  contractAddress: USDC_LOWER,
  chainId: Chain.Ethereum,
  isNative: false,
}

const proto = VaultBase.prototype as unknown as Record<string, (...args: never[]) => unknown>

const FEE_WEI = 136670384400000n

async function dryRun(symbol: string | undefined, amount = '0.01'): Promise<Extract<SendResult, { dryRun: true }>> {
  const vault = {
    _tokens: { [Chain.Ethereum]: [storedUsdc] },
    getTokens: proto.getTokens,
    resolveTokenInfo: proto.resolveTokenInfo,
    buildAccountCoin: proto.buildAccountCoin,
    parseAmount: proto.parseAmount,
    formatUnits: proto.formatUnits,
    address: async () => '0x58C4a1F319297EC9c398A0F3a3b64AF5a18b5C35',
    prepareSendTx: async () => ({}),
    transactionBuilder: { estimateSendFee: async () => FEE_WEI },
  }
  const result = await (proto.send as unknown as (this: unknown, p: unknown) => Promise<SendResult>).call(vault, {
    chain: Chain.Ethereum,
    to: '0x1111111111111111111111111111111111111111',
    amount,
    symbol,
    dryRun: true,
  })
  if (!result.dryRun) throw new Error('expected a dry-run result')
  return result
}

describe('send dry-run quotes the network fee in the native asset', () => {
  it('formats a token send fee with the NATIVE decimals and names the native asset', async () => {
    const result = await dryRun('USDC')
    expect(result.fee).toBe('0.0001366703844')
    expect(result.feeSymbol).toBe('ETH')
  })

  it('leaves a token send total equal to the amount, so it compares against the token balance', async () => {
    const result = await dryRun('USDC')
    expect(result.total).toBe('0.01')
  })

  it('still debits the fee from the amount for a native send', async () => {
    const result = await dryRun(undefined, '1')
    expect(result.feeSymbol).toBe('ETH')
    expect(result.fee).toBe('0.0001366703844')
    expect(result.total).toBe('1.0001366703844')
  })

  it('reports the same fee whether the token is named by symbol or by contract address', async () => {
    const bySymbol = await dryRun('USDC')
    const byAddress = await dryRun(USDC_LOWER)
    expect(byAddress).toMatchObject({ fee: bySymbol.fee, feeSymbol: bySymbol.feeSymbol, total: bySymbol.total })
  })
})
