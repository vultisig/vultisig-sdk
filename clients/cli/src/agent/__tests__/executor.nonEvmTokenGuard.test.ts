import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentErrorCode } from '../agentErrors'
import { AgentExecutor } from '../executor'

const destination = 'test-recipient'

function envelope(chain: Chain, amount: string, tokenResolved?: string) {
  return {
    chain,
    from_chain: chain,
    resolved: { labels: tokenResolved ? { token_resolved: tokenResolved } : {} },
    txArgs: { chain, to: destination, amount, memo: 'test-memo' },
  }
}

function vault(tokens: ReturnType<VaultBase['getTokens']> = []): VaultBase {
  return {
    name: 'token-guard-test',
    id: 'token-guard-test',
    type: 'secure',
    chains: [Chain.Solana, Chain.Bitcoin, Chain.THORChain, Chain.MayaChain],
    isEncrypted: false,
    getTokens: vi.fn().mockReturnValue(tokens),
    send: vi.fn().mockResolvedValue({ dryRun: false, txHash: 'test-hash' }),
  } as unknown as VaultBase
}

let journalDir: string
let previousJournal: string | undefined

beforeEach(() => {
  previousJournal = process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  journalDir = mkdtempSync(join(tmpdir(), 'vultisig-token-guard-'))
  process.env.VULTISIG_BROADCAST_JOURNAL_PATH = join(journalDir, 'broadcasts.jsonl')
})

afterEach(() => {
  if (previousJournal === undefined) delete process.env.VULTISIG_BROADCAST_JOURNAL_PATH
  else process.env.VULTISIG_BROADCAST_JOURNAL_PATH = previousJournal
  rmSync(journalDir, { recursive: true, force: true })
})

describe('AgentExecutor non-EVM token send guard', () => {
  it('rejects a known-registry symbol before vault.send', async () => {
    const testVault = vault()
    const executor = new AgentExecutor(testVault)
    expect(executor.storeServerTransaction(envelope(Chain.Solana, '1000000', 'USDC'))).toBe(true)

    const result = await executor.signTxFromBuffer('known-token')
    expect(result.success).toBe(false)
    expect(result.data?.code).toBe(AgentErrorCode.ACTION_NOT_IMPLEMENTED)
    expect(testVault.send).not.toHaveBeenCalled()
  })

  it('rejects a vault-configured symbol before vault.send', async () => {
    const testVault = vault([
      { id: 'custom-mint', symbol: 'CUSTOM', name: 'Custom', decimals: 5, chainId: Chain.Solana },
    ])
    const executor = new AgentExecutor(testVault)
    expect(executor.storeServerTransaction(envelope(Chain.Solana, '123456', 'CUSTOM'))).toBe(true)

    const result = await executor.signTxFromBuffer('configured-token')
    expect(result.success).toBe(false)
    expect(result.data?.code).toBe(AgentErrorCode.ACTION_NOT_IMPLEMENTED)
    expect(testVault.send).not.toHaveBeenCalled()
  })

  it.each([
    [
      'same-ticker token id',
      Chain.Solana,
      { txArgs: { ...envelope(Chain.Solana, '1000000', 'SOL').txArgs, token_id: 'foreign-mint' } },
    ],
    ['alternate symbol label', Chain.Solana, { resolved: { labels: { token_symbol: 'USDC' } } }],
    [
      'unknown token with an ignored deposit hint',
      Chain.Solana,
      {
        resolved: { labels: { token_resolved: 'UNKNOWN' } },
        txArgs: { ...envelope(Chain.Solana, '1000000').txArgs, msg_type: 'deposit' },
      },
    ],
    ['asset alias', Chain.Solana, { txArgs: { ...envelope(Chain.Solana, '1000000', 'SOL').txArgs, asset: 'USDC' } }],
    ['coin alias', Chain.Solana, { txArgs: { ...envelope(Chain.Solana, '1000000', 'SOL').txArgs, coin: 'USDC' } }],
    [
      'structured asset hint',
      Chain.Solana,
      { txArgs: { ...envelope(Chain.Solana, '1000000', 'SOL').txArgs, asset: { symbol: 'SOL', id: 'foreign-mint' } } },
    ],
    [
      'non-native Cosmos denom',
      Chain.THORChain,
      { txArgs: { ...envelope(Chain.THORChain, '1000000', 'RUNE').txArgs, denom: 'x/usdc' } },
    ],
  ])('refuses %s before vault.send', async (scenario, chain, fields) => {
    const testVault = vault()
    const executor = new AgentExecutor(testVault)
    expect(executor.storeServerTransaction({ ...envelope(chain, '1000000'), ...fields })).toBe(true)

    const result = await executor.signTxFromBuffer(`token-hint-${scenario}`)
    expect(result.success).toBe(false)
    expect(result.data?.code).toBe(AgentErrorCode.ACTION_NOT_IMPLEMENTED)
    expect(testVault.send).not.toHaveBeenCalled()
  })

  it.each([
    [Chain.Solana, '1000000', 'SOL', '0.001'],
    [Chain.Bitcoin, '1000', 'BTC', '0.00001'],
    [Chain.THORChain, '1000000', 'RUNE', '0.01'],
    [Chain.MayaChain, '100000000', 'CACAO', '0.01'],
  ])('keeps native %s send amount, destination, memo, and omitted symbol', async (chain, baseUnits, symbol, amount) => {
    const testVault = vault()
    const executor = new AgentExecutor(testVault)
    expect(executor.storeServerTransaction(envelope(chain, baseUnits, symbol))).toBe(true)

    const result = await executor.signTxFromBuffer(`native-${chain}`)
    expect(result.success).toBe(true)
    expect(testVault.send).toHaveBeenCalledOnce()
    expect(testVault.send).toHaveBeenCalledWith({
      chain,
      to: destination,
      amount,
      symbol: undefined,
      memo: 'test-memo',
    })
  })

  it('keeps a native send with no token label', async () => {
    const testVault = vault()
    const executor = new AgentExecutor(testVault)
    expect(executor.storeServerTransaction(envelope(Chain.Bitcoin, '1000'))).toBe(true)

    const result = await executor.signTxFromBuffer('native-without-label')
    expect(result.success).toBe(true)
    expect(testVault.send).toHaveBeenCalledWith({
      chain: Chain.Bitcoin,
      to: destination,
      amount: '0.00001',
      symbol: undefined,
      memo: 'test-memo',
    })
  })

  it.each(['asset', 'coin'])('keeps an explicit native %s alias', async alias => {
    const testVault = vault()
    const executor = new AgentExecutor(testVault)
    const nativeEnvelope = envelope(Chain.Solana, '1000000', 'SOL')
    expect(
      executor.storeServerTransaction({ ...nativeEnvelope, txArgs: { ...nativeEnvelope.txArgs, [alias]: 'sol' } })
    ).toBe(true)

    const result = await executor.signTxFromBuffer(`native-${alias}`)
    expect(result.success).toBe(true)
    expect(testVault.send).toHaveBeenCalledOnce()
    expect(testVault.send).toHaveBeenCalledWith({
      chain: Chain.Solana,
      to: destination,
      amount: '0.001',
      symbol: undefined,
      memo: 'test-memo',
    })
  })
})
