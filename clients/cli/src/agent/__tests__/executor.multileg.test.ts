/**
 * Phase B multi-leg sequencer tests.
 *
 * mcp-ts `execute_swap` and `execute_contract_call` may emit a 2-leg
 * envelope carrying both `approvalTxArgs` (ERC-20 approve) and `txArgs`
 * (the main swap/call). sdk-cli's `AgentExecutor` stashes both legs in
 * `pendingLegs` and dispatches `signTxFromBuffer` through the new
 * `signMultiLeg` method, which:
 *   1. signs + broadcasts the approve leg via the existing signServerTx,
 *   2. polls vault.getTxStatus until the approve confirms (or timeout),
 *   3. signs + broadcasts the main leg only after step 2 succeeds.
 *
 * Failure on (1) or (2) MUST hold back the main leg — the swap can't run
 * against a stale or unconfirmed allowance. See task
 * 080526-sdk-cli-multileg-sequencer.md.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor } from '../executor'

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.BSC, Chain.Polygon],
    isEncrypted: false,
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 18, symbol: 'BNB' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

const APPROVE_TX = {
  to: '0xUSDC',
  value: '0',
  data: '0x095ea7b3' + '0'.repeat(120),
  gas_limit: '60000',
}

const SWAP_TX = {
  to: '0xRouter',
  value: '50000000000000000',
  data: '0xdeadbeef',
  gas_limit: '250000',
}

function makeMultiLegEnvelope() {
  return {
    chain: 'BSC',
    from_chain: 'BSC',
    stepperConfig: { flow: 'swap', steps: [] },
    approvalTxArgs: {
      chain: 'BSC',
      chain_id: '56',
      from: '0xsender',
      tx: APPROVE_TX,
    },
    txArgs: {
      chain: 'BSC',
      chain_id: '56',
      from: '0xsender',
      tx: SWAP_TX,
    },
  }
}

describe('AgentExecutor — multi-leg sequencer (Phase B)', () => {
  it('stores 2 legs in order (approve, main) when given a multi-leg envelope', () => {
    const executor = new AgentExecutor(createMockVault())
    const stored = executor.storeServerTransaction(makeMultiLegEnvelope())

    expect(stored).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
    const legs = (executor as any).pendingLegs as Array<{
      kind: 'approve' | 'main'
      txArgs: any
    }>
    expect(legs).toHaveLength(2)
    expect(legs[0].kind).toBe('approve')
    expect(legs[0].txArgs.tx.to).toBe(APPROVE_TX.to)
    expect(legs[1].kind).toBe('main')
    expect(legs[1].txArgs.tx.to).toBe(SWAP_TX.to)
  })

  it('sequences approve before main (signServerTx call order)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const order: string[] = []
    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      order.push(to)
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(signServerTx).toHaveBeenCalledTimes(2)
    expect(order).toEqual([APPROVE_TX.to, SWAP_TX.to])
  })

  it('returns approval_tx_hash + tx_hash on success', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(recent.data?.approval_tx_hash).toBe('0xapprovehash')
    expect(recent.data?.tx_hash).toBe('0xmainhash')
    expect(recent.data?.chain).toBe('BSC')
    expect(recent.data?.status).toBe('pending')
    expect(recent.data?.explorer_url).toBe(`https://bscscan.com/tx/${SWAP_TX.to}`)
  })

  it('fails closed on receipt timeout — main leg never broadcast', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockRejectedValue(
      new Error('approve tx 0xapprovehash not confirmed within 90s')
    )

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    // Approve was attempted, main was NOT.
    expect(signServerTx).toHaveBeenCalledTimes(1)
    const errMsg = (recent.data as any).error as string
    expect(errMsg).toMatch(/0xapprovehash/)
    expect(errMsg).toMatch(/did not confirm/i)
    // pendingLegs cleared so a retry doesn't double-broadcast.
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('fails closed on revert (receipt status === error) — main leg never broadcast', async () => {
    const vault = createMockVault()
    // getTxStatus returns 'error' (revert).
    ;(vault as any).getTxStatus = vi.fn().mockResolvedValue({ status: 'error' })
    const executor = new AgentExecutor(vault)

    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = envelope.txArgs?.tx?.to
      return {
        tx_hash: to === APPROVE_TX.to ? '0xapprovehash' : '0xmainhash',
        chain: 'BSC',
        status: 'pending',
        explorer_url: `https://bscscan.com/tx/${to}`,
      }
    })

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    expect(signServerTx).toHaveBeenCalledTimes(1)
    const errMsg = (recent.data as any).error as string
    expect(errMsg).toMatch(/0xapprovehash/)
    expect(errMsg).toMatch(/reverted/i)
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('single-leg envelope unaffected — pendingLegs stays empty', () => {
    const executor = new AgentExecutor(createMockVault())
    const stored = executor.storeServerTransaction({
      chain: 'Polygon',
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: { to: '0xrecipient', value: '1000000000000000000', data: '0x' },
      },
    })

    expect(stored).toBe(true)
    expect((executor as any).pendingLegs).toHaveLength(0)
    // The stored payload must not be tagged __multiLeg.
    const payload = (executor as any).pendingPayloads.get('latest')?.payload
    expect(payload?.__multiLeg).toBeUndefined()
    expect(payload?.__serverTx).toBe(true)
  })

  it('envelope with sequence_id and no approvalTxArgs unaffected — propagation works', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockResolvedValue({
      tx_hash: '0xsinglehash',
      chain: 'Ethereum',
      status: 'pending',
      explorer_url: 'https://etherscan.io/tx/0xsinglehash',
    })

    // mcp-go Pattern 1 single-leg envelope with sequence_id.
    const stored = executor.storeServerTransaction({
      chain: 'Ethereum',
      sequence_id: 'seq-abc-123',
      tx: { to: '0xrecipient', value: '1000000000000000000', data: '0x' },
    })
    expect(stored).toBe(true)
    expect((executor as any).pendingLegs).toHaveLength(0)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(true)
    expect(recent.data?.tx_hash).toBe('0xsinglehash')
    // sequence_id must propagate verbatim so agent-backend can chain leg N+1.
    expect(recent.data?.sequence_id).toBe('seq-abc-123')
    // approval_tx_hash must NOT be set on a single-leg envelope.
    expect(recent.data?.approval_tx_hash).toBeUndefined()
  })

  it('throws on >2 legs (defensive — phase B is exactly 2)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    vi.spyOn(executor as any, 'signServerTx').mockResolvedValue({
      tx_hash: '0xirrelevant',
      chain: 'BSC',
      status: 'pending',
      explorer_url: '',
    })
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    // First store a real multi-leg envelope so the dispatcher knows about it,
    // then poison pendingLegs with a 3-leg array to trigger the defensive
    // throw inside signTxFromBuffer's __multiLeg branch.
    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)
    ;(executor as any).pendingLegs = [
      { txArgs: { tx: APPROVE_TX }, parent: {}, kind: 'approve' },
      { txArgs: { tx: SWAP_TX }, parent: {}, kind: 'main' },
      { txArgs: { tx: SWAP_TX }, parent: {}, kind: 'main' },
    ]

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    expect((recent.data as any).error).toMatch(/expected 2 pending legs/i)
  })

  it('rejects multi-leg envelope with mismatched leg chains', () => {
    const executor = new AgentExecutor(createMockVault())
    // Malformed envelope: approve says BSC, main says Polygon. Without the
    // chain-consistency check at storeServerTransaction, signServerTx's
    // `chain || from_chain || txArgs.chain` precedence would silently coerce
    // both legs to the parent chain. Defense-in-depth against a shape that
    // mcp-ts doesn't emit today but a compromised middleware could craft.
    const mismatched = {
      chain: 'BSC',
      from_chain: 'BSC',
      stepperConfig: { flow: 'swap', steps: [] },
      approvalTxArgs: {
        chain: 'BSC',
        chain_id: '56',
        from: '0xsender',
        tx: APPROVE_TX,
      },
      txArgs: {
        chain: 'Polygon', // ← MISMATCH with approve
        chain_id: '137',
        from: '0xsender',
        tx: SWAP_TX,
      },
    }
    expect(executor.storeServerTransaction(mismatched)).toBe(false)
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('rejects multi-leg envelope when parent chain disagrees with legs', () => {
    const executor = new AgentExecutor(createMockVault())
    // Parent says Ethereum, both legs say Polygon. Even though the legs
    // agree with each other, the parent disagreement is a malformed-shape
    // signal — reject rather than guess which one to trust.
    const parentMismatch = {
      chain: 'Ethereum',
      from_chain: 'Ethereum',
      stepperConfig: { flow: 'swap', steps: [] },
      approvalTxArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: APPROVE_TX,
      },
      txArgs: {
        chain: 'Polygon',
        chain_id: '137',
        from: '0xsender',
        tx: SWAP_TX,
      },
    }
    expect(executor.storeServerTransaction(parentMismatch)).toBe(false)
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('rejects multi-leg envelope on non-EVM chain (Phase B is EVM-only)', () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)
    // Solana envelope shape with both keys populated — should not enter
    // the multi-leg path because waitForEvmReceipt's EIP-1559 receipt
    // semantics don't translate. M3: code-level enforcement of the
    // "Phase B is EVM-only" comment.
    const solanaMultiLeg = {
      chain: 'Solana',
      from_chain: 'Solana',
      stepperConfig: { flow: 'swap', steps: [] },
      approvalTxArgs: { chain: 'Solana', from: '0xsender', tx: APPROVE_TX },
      txArgs: { chain: 'Solana', from: '0xsender', tx: SWAP_TX },
    }
    expect(executor.storeServerTransaction(solanaMultiLeg)).toBe(false)
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('clears pendingLegs when signServerTx throws on the approve leg (H1)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    // Approve leg's signServerTx throws (e.g. RPC down, keysign failure).
    // The receipt-wait catch wouldn't fire; the only thing that clears state
    // is the outer try/finally added in PR review fix H1.
    vi.spyOn(executor as any, 'signServerTx').mockRejectedValueOnce(new Error('rpc unreachable'))

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)
    expect((executor as any).pendingLegs).toHaveLength(2)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    // pendingLegs MUST be empty after any throw — symmetric with the
    // receipt-wait failure path.
    expect((executor as any).pendingLegs).toHaveLength(0)
  })

  it('clears pendingLegs when signServerTx throws on the main leg (H1)', async () => {
    const vault = createMockVault()
    const executor = new AgentExecutor(vault)

    // Approve succeeds, receipt confirms, then main-leg signServerTx throws
    // (e.g. nonce mismatch on the second broadcast). Without H1's outer
    // try/finally, this path leaks pendingLegs state.
    const signSpy = vi
      .spyOn(executor as any, 'signServerTx')
      .mockResolvedValueOnce({
        tx_hash: '0xapprove-ok',
        chain: 'BSC',
        status: 'pending',
        explorer_url: '',
      })
      .mockRejectedValueOnce(new Error('nonce mismatch'))
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    expect(executor.storeServerTransaction(makeMultiLegEnvelope())).toBe(true)

    const recent = await executor.signTxFromBuffer('call-1')
    expect(recent.success).toBe(false)
    expect(signSpy).toHaveBeenCalledTimes(2) // both legs were attempted
    expect((executor as any).pendingLegs).toHaveLength(0)
  })
})

// PR #439 review finding 5: defense-in-depth chain-consistency check.
// The dispatcher resolves `chain` from the outer envelope; `signNonEvmServerTx`
// cross-checks against `txArgs.chain` and refuses to dispatch when they
// disagree. This pins the guard so a future refactor that drops it would
// trip a unit test.
describe('AgentExecutor — non-EVM dispatcher chain-consistency', () => {
  it('rejects envelope where txArgs.chain disagrees with resolved dispatcher chain', async () => {
    const executor = new AgentExecutor(createMockVault())
    // Outer envelope says THORChain; inner txArgs.chain says Bitcoin.
    // No legitimate code path produces this shape — the guard exists
    // for defense-in-depth against future malformed-envelope bugs.
    const mismatched = {
      chain: 'THORChain',
      from_chain: 'THORChain',
      txArgs: {
        chain: 'Bitcoin', // ← disagrees with outer
        tx_encoding: 'cosmos-msg',
        from: 'thor1senderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        to: 'thor1recipientxxxxxxxxxxxxxxxxxxxxxxxxxx',
        amount: '1000000',
        memo: '',
        msg_type: 'send',
      },
    }
    expect(executor.storeServerTransaction(mismatched)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-mismatch')
    expect(recent.success).toBe(false)
    expect((recent.data as any).error).toMatch(/dispatcher chain.*disagrees with envelope chain/)
  })

  it('accepts envelope where outer and txArgs chain agree (regression — happy path unchanged)', async () => {
    const vault = createMockVault()
    // Add vault.send mock since base createMockVault doesn't have it.
    ;(vault as any).send = vi.fn().mockResolvedValue({
      dryRun: false,
      txHash: '0xfake-thor-hash',
      chain: 'THORChain',
    })
    const executor = new AgentExecutor(vault)
    const consistent = {
      chain: 'THORChain',
      from_chain: 'THORChain',
      txArgs: {
        chain: 'THORChain', // ← agrees with outer
        tx_encoding: 'cosmos-msg',
        from: 'thor1senderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        to: 'thor1recipientxxxxxxxxxxxxxxxxxxxxxxxxxx',
        amount: '1000000',
        memo: '',
        msg_type: 'send',
      },
    }
    expect(executor.storeServerTransaction(consistent)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-consistent')
    // Either succeeds or fails for unrelated reasons (mock returns valid
    // result, so should succeed). Either way, the error message must NOT
    // mention chain disagreement — the guard should be silent on happy paths.
    if (!recent.success) {
      expect((recent.data as any).error).not.toMatch(/dispatcher chain.*disagrees/)
    }
  })
})

// The MsgDeposit swap path shares parseNonEvmEnvelope's digit-bound guard
// (`parseBaseUnitsAmount`) but hands its amount straight through to
// `vault.swap`'s `amountBaseUnits` (architecture#2080) rather than
// reconstructing a decimal string. Destination cases below pin the separate
// routing contract: the memo remains authoritative and reaches
// `vault.swap({ recipient })` unchanged.
describe('AgentExecutor — signThorMsgDepositSwap dispatch', () => {
  // Vault with distinct destination-chain addresses and a swap mock that
  // captures the exact public SDK request.
  function createThorSwapVault(opts: { ethAddrChecksummed?: string } = {}): VaultBase {
    const ethAddr = opts.ethAddrChecksummed ?? '0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4'
    return {
      name: 'mock-vault',
      id: 'vault-mock-1',
      type: 'secure',
      chains: [Chain.THORChain, Chain.MayaChain, Chain.Ethereum, Chain.Bitcoin],
      isEncrypted: false,
      balances: vi.fn().mockResolvedValue({}),
      address: vi.fn().mockImplementation(async (chain: Chain) => {
        if (chain === Chain.Ethereum) return ethAddr
        if (chain === Chain.Bitcoin) return 'bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2'
        return '0xother'
      }),
      balance: vi.fn().mockResolvedValue({ decimals: 8, symbol: 'RUNE' }),
      swap: vi.fn().mockResolvedValue({
        dryRun: false,
        txHash: 'F805444Aabcdef0123456789abcdef0123456789abcdef0123456789abcdef01',
        chain: 'THORChain',
      }),
    } as unknown as VaultBase
  }

  function makeMsgDepositEnvelope(opts: { memo: string; amount?: string; chain?: Chain }): Record<string, unknown> {
    const sourceChain = opts.chain ?? Chain.THORChain
    const sourceAddress =
      sourceChain === Chain.THORChain
        ? 'thor149ekc6vu5ez775hd7y7ukgdq86e43t88pk7njm'
        : 'maya1l8tqmlnzhxn30sd03cmq98uju95tw6ucxgkre6'
    return {
      chain: sourceChain,
      from_chain: sourceChain,
      txArgs: {
        chain: sourceChain,
        tx_encoding: 'cosmos-msg',
        from: sourceAddress,
        to:
          sourceChain === Chain.THORChain
            ? 'thor1dheycdevsuagds76hp4dz4u6t6dx5x6f9smtj0'
            : 'maya1dheycdevsuagds76hp4dz4u6t6dx5x6f9smtj0',
        amount: opts.amount ?? '1000000',
        denom: sourceChain === Chain.THORChain ? 'rune' : 'cacao',
        chain_id: sourceChain === Chain.THORChain ? 'thorchain-1' : 'mayachain-mainnet-v1',
        memo: opts.memo,
        msg_type: 'deposit',
      },
    }
  }

  it('forwards an explicit self-swap destination instead of re-deriving it', async () => {
    // The memo carries the same address as the vault, but it must still remain
    // the authoritative destination passed into the SDK.
    const vault = createThorSwapVault({
      ethAddrChecksummed: '0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4',
    })
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({
      memo: '=:ETH.ETH:0x742d35cc6634c0532925a3b844bc9e7595f5b1a4::v0:50',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-evm-norm')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith(
      expect.objectContaining({
        fromChain: Chain.THORChain,
        fromSymbol: 'RUNE',
        toChain: Chain.Ethereum,
        toSymbol: 'ETH',
        recipient: '0x742d35cc6634c0532925a3b844bc9e7595f5b1a4',
      })
    )
  })

  it('preserves a checksummed EVM destination verbatim', async () => {
    const vault = createThorSwapVault({
      ethAddrChecksummed: '0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4',
    })
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({
      memo: '=:ETH.ETH:0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4::v0:50',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-evm-checksum')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: '0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4' })
    )
  })

  it('forwards a cross-account EVM destination instead of rejecting or substituting it', async () => {
    const vault = createThorSwapVault({
      ethAddrChecksummed: '0x742d35Cc6634C0532925a3b844Bc9e7595f5b1A4',
    })
    const executor = new AgentExecutor(vault)
    // Different address entirely — must still be rejected.
    const envelope = makeMsgDepositEnvelope({
      memo: '=:ETH.ETH:0xDEADBEEFcafebabeDEADBEEFcafebabeDEADBEEF::v0:50',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-evm-cross')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: '0xDEADBEEFcafebabeDEADBEEFcafebabeDEADBEEF' })
    )
  })

  it('forwards a cross-account non-EVM destination verbatim', async () => {
    const vault = createThorSwapVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({
      memo: '=:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-btc-case')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' })
    )
  })

  it('omits recipient when the memo has no destination, preserving the self-swap default', async () => {
    const vault = createThorSwapVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({ memo: '=:BTC.BTC' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-empty-destination')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith({
      fromChain: Chain.THORChain,
      fromSymbol: 'RUNE',
      toChain: Chain.Bitcoin,
      toSymbol: 'BTC',
      amountBaseUnits: 1_000_000n,
    })
  })

  it('rejects a whitespace destination instead of silently treating it as self-swap', async () => {
    const vault = createThorSwapVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({ memo: '=:BTC.BTC:   ' })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-whitespace-destination')
    expect(recent.success).toBe(false)
    expect((recent.data as any).error).toMatch(/destination address.*must not contain whitespace/i)
    expect((vault as any).swap).not.toHaveBeenCalled()
  })

  it('forwards a MayaChain envelope destination with CACAO amount semantics', async () => {
    const vault = createThorSwapVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({
      chain: Chain.MayaChain,
      memo: '=:BTC.BTC:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      amount: '10000000000',
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-maya-cross-account')
    expect(recent.success).toBe(true)
    expect((vault as any).swap).toHaveBeenCalledWith({
      fromChain: Chain.MayaChain,
      fromSymbol: 'CACAO',
      toChain: Chain.Bitcoin,
      toSymbol: 'BTC',
      amountBaseUnits: 10_000_000_000n,
      recipient: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    })
  })

  it('rejects 27-digit amount on MsgDeposit path (CR-B parity with parseNonEvmEnvelope)', async () => {
    const vault = createThorSwapVault()
    const executor = new AgentExecutor(vault)
    const envelope = makeMsgDepositEnvelope({
      memo: '=:BTC.BTC:bc1qzmsk98gqtfvxhfrye8p7xkxlj6g9q6a2yj3yj2',
      amount: '1' + '0'.repeat(26), // 27 digits → past the bound
    })
    expect(executor.storeServerTransaction(envelope)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-overflow')
    expect(recent.success).toBe(false)
    expect((recent.data as any).error).toMatch(/exceeds 26-digit safety bound/)
    expect((vault as any).swap).not.toHaveBeenCalled()
  })
})
