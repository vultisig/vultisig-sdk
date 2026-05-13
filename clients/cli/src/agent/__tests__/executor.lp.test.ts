/**
 * Phase E THORChain LP MsgDeposit dispatch tests.
 *
 * sdk-cli's `signNonEvmServerTx` previously only handled THORChain swap
 * memos (`=:`). LP add (`+:`) and remove (`-:`) memos now route through
 * `vault.signMsgDeposit`, which builds a THORChainDeposit cosmos message
 * via the SDK's keysign pipeline.
 *
 * These tests cover:
 *   - LP add envelopes (with and without paired_address)
 *   - LP remove envelopes (with and without withdrawToAsset)
 *   - Memo passthrough verbatim (sdk-cli treats memo as opaque)
 *   - Swap memo regression (Phase D still routes through vault.swap)
 *   - Unsupported memo prefixes (loan / validator ops throw NotImplemented)
 *   - Magnitude-bug safety bound on amount
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMsgDepositVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-lp',
    type: 'secure',
    chains: [Chain.THORChain, Chain.MayaChain, Chain.Bitcoin],
    isEncrypted: false,
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn().mockResolvedValue('thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'),
    balance: vi.fn().mockResolvedValue({ decimals: 8, symbol: 'RUNE' }),
    signMsgDeposit: vi.fn().mockResolvedValue({
      chain: Chain.THORChain,
      txHash: 'AABBCCDDEEFF0011223344556677889900AABBCCDDEEFF0011223344556677',
    }),
    swap: vi.fn().mockResolvedValue({
      dryRun: false,
      txHash: 'F805444Aabcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
      chain: 'THORChain',
    }),
  } as unknown as VaultBase
}

function makeLpEnvelope(opts: { memo: string; amount?: string; chain?: string }): Record<string, unknown> {
  return {
    chain: opts.chain ?? 'THORChain',
    from_chain: opts.chain ?? 'THORChain',
    txArgs: {
      chain: opts.chain ?? 'THORChain',
      tx_encoding: 'cosmos-msg',
      from: 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm',
      to: '',
      amount: opts.amount ?? '100000000', // 1 RUNE base units
      denom: 'rune',
      memo: opts.memo,
      msg_type: 'deposit',
    },
  }
}

describe('AgentExecutor — LP MsgDeposit dispatch (Phase E)', () => {
  it('routes LP add memo (+:POOL) through vault.signMsgDeposit with memo verbatim', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({ memo: '+:BTC.BTC', amount: '100000000' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-lp-add')
    expect(recent.success).toBe(true)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledTimes(1)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledWith({
      chain: Chain.THORChain,
      amountBaseUnits: '100000000',
      memo: '+:BTC.BTC',
    })
    expect((vault as any).swap).not.toHaveBeenCalled()
  })

  it('routes LP add with paired_address — memo is opaque pass-through', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({
      memo: '+:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
      amount: '500000000',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-lp-add-paired')
    expect(recent.success).toBe(true)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledWith({
      chain: Chain.THORChain,
      amountBaseUnits: '500000000',
      memo: '+:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
    })
  })

  it('routes LP remove memo (-:POOL:BPS) through vault.signMsgDeposit', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    // Remove uses a 0.02 RUNE dust amount (2_000_000 base units).
    const envelope = makeLpEnvelope({ memo: '-:BTC.BTC:5000', amount: '2000000' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-lp-remove')
    expect(recent.success).toBe(true)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledWith({
      chain: Chain.THORChain,
      amountBaseUnits: '2000000',
      memo: '-:BTC.BTC:5000',
    })
  })

  it('routes LP remove with withdrawToAsset segment verbatim', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({ memo: '-:BTC.BTC:10000:BTC', amount: '2000000' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-lp-remove-asset')
    expect(recent.success).toBe(true)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledWith({
      chain: Chain.THORChain,
      amountBaseUnits: '2000000',
      memo: '-:BTC.BTC:10000:BTC',
    })
  })

  it('routes MayaChain LP memos with CACAO base units passed through verbatim', async () => {
    const vault = createMsgDepositVault()
    // Override address mock to a Maya address; default mock is fine for dispatch.
    ;(vault as any).address = vi
      .fn()
      .mockResolvedValue('maya1l8tqmlnzhxn30sd03cmq98uju95tw6ucxgkre6')
    ;(vault as any).signMsgDeposit = vi.fn().mockResolvedValue({
      chain: Chain.MayaChain,
      txHash: 'CACAOTXHASH',
    })
    const executor = new AgentExecutor(vault)
    // CACAO has 10 decimals — 1 CACAO = 1e10 base units.
    const envelope = makeLpEnvelope({
      chain: 'MayaChain',
      memo: '+:BTC.BTC',
      amount: '10000000000',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-maya-lp-add')
    expect(recent.success).toBe(true)
    expect((vault as any).signMsgDeposit).toHaveBeenCalledWith({
      chain: Chain.MayaChain,
      amountBaseUnits: '10000000000',
      memo: '+:BTC.BTC',
    })
  })

  it('rejects unsupported MsgDeposit memo prefix (BOND:...) with NotImplemented', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({ memo: 'BOND:thornode1...' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-bond-reject')
    expect(recent.success).toBe(false)
    // The error surface uses AgentExecutor's standard error wrapping;
    // assert the memo prefix surfaces in the error message rather than
    // probing a specific error code.
    expect(String(recent.data?.error ?? '')).toMatch(/not supported|NOT_IMPLEMENTED/i)
    expect((vault as any).signMsgDeposit).not.toHaveBeenCalled()
    expect((vault as any).swap).not.toHaveBeenCalled()
  })

  it('rejects loan memo (LOAN+:...) with NotImplemented', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({ memo: 'LOAN+:BTC.BTC:bc1q...:0' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-loan-reject')
    expect(recent.success).toBe(false)
    expect((vault as any).signMsgDeposit).not.toHaveBeenCalled()
  })

  it('rejects empty memo (bare MsgDeposit) with NotImplemented', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({ memo: '' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-empty-memo')
    expect(recent.success).toBe(false)
    expect((vault as any).signMsgDeposit).not.toHaveBeenCalled()
  })

  it('rejects magnitude-bug amount (>26 digits) with InvalidAmount', async () => {
    const vault = createMsgDepositVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({
      memo: '+:BTC.BTC',
      amount: '1'.padEnd(27, '0'), // 27 digits
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-magnitude-bug')
    expect(recent.success).toBe(false)
    expect((vault as any).signMsgDeposit).not.toHaveBeenCalled()
  })

  it('regression — swap memo (=:CHAIN.ASSET:DEST) still routes to vault.swap (Phase D)', async () => {
    const vault = createMsgDepositVault()
    // Override address mocks to support the self-swap fund-safety guard.
    ;(vault as any).address = vi.fn().mockImplementation(async (chain: Chain) => {
      if (chain === Chain.Bitcoin) return 'bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2'
      return 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'
    })
    const executor = new AgentExecutor(vault)
    const envelope = makeLpEnvelope({
      memo: '=:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2::v0:50',
      amount: '100000000',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-swap-regress')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledTimes(1)
    expect((vault as any).signMsgDeposit).not.toHaveBeenCalled()
  })
})
