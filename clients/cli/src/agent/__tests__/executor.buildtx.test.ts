/**
 * Design B end-to-end: a Polymarket flat-tx-builder tool output, lifted by
 * `buildTxReadyFromToolOutput`, must traverse the EXISTING executor signing
 * pipeline unchanged:
 *   - single flat envelope → single-leg `signServerTx` (extractNestedTx finds `tx`);
 *   - bundled approve+wrap → `signMultiLeg` (approve → receipt-wait → wrap).
 *
 * This pins the wrapping shape against the real executor so a future change to
 * `extractNestedTx` / `storeServerTransaction` / `getPendingSummary` that would
 * break Polymarket signing fails here.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { encodeFunctionData, erc20Abi } from 'viem'
import { describe, expect, it, vi } from 'vitest'

import { AgentExecutor, extractNestedTx } from '../executor'
import {
  buildTxReadyFromToolOutput,
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
} from '../toolOutputSigning'

const USDC_E = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const ONRAMP = '0x1234567890abcdef1234567890abcdef12345678'
// Real approve(spender, 1 USDC.e) calldata: the consent line now decodes approve
// legs from calldata (T12), and truncated approve calldata fails closed.
const SPENDER = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E'
const APPROVE_DATA = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SPENDER, 1_000_000n] })
const WRAP_DATA = '0x62355638' + '0'.repeat(192)

function createMockVault(): VaultBase {
  return {
    name: 'mock-vault',
    id: 'vault-mock-1',
    type: 'secure',
    chains: [Chain.Ethereum, Chain.Polygon],
    isEncrypted: false,
    balances: vi.fn().mockResolvedValue({}),
    address: vi.fn().mockResolvedValue('0xsender'),
    balance: vi.fn().mockResolvedValue({ decimals: 6, symbol: 'USDC.e' }),
    getTxStatus: vi.fn().mockResolvedValue({ status: 'success' }),
  } as unknown as VaultBase
}

function setupTradingApprove() {
  return { chain: 'Polygon', chain_id: '137', to: USDC_E, value: '0', data: APPROVE_DATA, action: 'approve' }
}
function depositWrapBundled() {
  return {
    chain: 'Polygon',
    chain_id: '137',
    to: ONRAMP,
    value: '0',
    data: WRAP_DATA,
    gas_limit: '250000',
    action: 'wrap_usdce_to_pusd',
    needs_approval: true,
    approval_tx: { to: USDC_E, data: APPROVE_DATA, value: '0' },
  }
}

describe('build-tx bridge → executor single-leg', () => {
  it('wrapped flat envelope is recognized by extractNestedTx via `tx`', () => {
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, setupTradingApprove())
    expect(wrapped).not.toBeNull()
    const nested = extractNestedTx(wrapped)
    expect(nested).toMatchObject({ to: USDC_E, value: '0', data: APPROVE_DATA })
  })

  it('storeServerTransaction buffers it and getPendingSummary names the contract + action', () => {
    const executor = new AgentExecutor(createMockVault())
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, setupTradingApprove())
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    expect(executor.hasPendingTransaction()).toBe(true)
    const summary = executor.getPendingSummary()
    // the approve is rendered from its calldata: spender + amount + token contract, plus the action tag
    expect(summary).toContain('approve ')
    expect(summary).toContain(`for spender ${SPENDER}`)
    expect(summary).toContain(USDC_E)
    expect(summary).toContain('on Polygon')
    expect(summary).toContain('[approve]')
    expect(summary).not.toContain('contract call on Polygon')
    // single-leg: not flagged multi-leg
    expect(summary).not.toContain('2 transactions')
  })

  it('signs via single-leg signServerTx (not multi-leg)', async () => {
    const executor = new AgentExecutor(createMockVault())
    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => ({
      tx_hash: '0xhash',
      chain: 'Polygon',
      status: 'pending',
      explorer_url: 'https://polygonscan.com/tx/0xhash',
      _to: extractNestedTx(envelope)?.to,
    }))

    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, {
      ...setupTradingApprove(),
      to: USDC_E,
    })
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-1')

    expect(recent.success).toBe(true)
    expect(signServerTx).toHaveBeenCalledTimes(1)
    // the envelope handed to signServerTx exposes the flat tx under `tx`
    const env = signServerTx.mock.calls[0][0] as any
    expect(extractNestedTx(env)).toMatchObject({ to: USDC_E, data: APPROVE_DATA })
  })
})

describe('build-tx bridge → executor multi-leg (bundled approve+wrap)', () => {
  it('buffers two legs (approve, main) with nested tx each', () => {
    const executor = new AgentExecutor(createMockVault())
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapBundled())
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    const legs = (executor as any).pendingLegs as Array<{ kind: string; txArgs: any }>
    expect(legs).toHaveLength(2)
    expect(legs[0].kind).toBe('approve')
    expect(legs[0].txArgs.tx.to).toBe(USDC_E)
    expect(legs[1].kind).toBe('main')
    expect(legs[1].txArgs.tx.to).toBe(ONRAMP)
  })

  it('getPendingSummary shows the wrap destination + the bundled approval leg', () => {
    const executor = new AgentExecutor(createMockVault())
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapBundled())
    executor.storeServerTransaction(wrapped)
    const summary = executor.getPendingSummary()
    expect(summary).toContain('contract call on Polygon')
    expect(summary).toContain(ONRAMP)
    // the bundled approval leg is disclosed from ITS calldata, not as an anonymous "token approval"
    expect(summary).toContain(`(+ first approve `)
    expect(summary).toContain(`for spender ${SPENDER}`)
    expect(summary).toContain(USDC_E)
    expect(summary).toContain('2 transactions')
    expect(summary).toContain('[wrap_usdce_to_pusd]')
  })

  it('wrap-only flat bridge envelope (no approve) still renders the contract-call line with its action tag', () => {
    const executor = new AgentExecutor(createMockVault())
    const env = { chain: 'Polygon', chain_id: '137', to: ONRAMP, value: '0', data: WRAP_DATA, action: 'wrap_usdce_to_pusd' }
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    expect(executor.getPendingSummary()).toBe(`contract call on Polygon to ${ONRAMP} [wrap_usdce_to_pusd]`)
  })

  it('drops a non-slug `action` from the calldata-derived approve line (producer text cannot contradict it)', () => {
    const executor = new AgentExecutor(createMockVault())
    const env = { ...setupTradingApprove(), action: 'limited to 5 USDC' }
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_SETUP_TRADING_TOOL, env)
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    const summary = executor.getPendingSummary()!
    expect(summary).toContain(`for spender ${SPENDER}`)
    expect(summary).not.toContain('limited to 5 USDC')
    expect(summary).not.toContain('[')
  })

  it('fails closed when the bundled approval leg carries truncated approve calldata', () => {
    const executor = new AgentExecutor(createMockVault())
    const env = depositWrapBundled()
    env.approval_tx = { to: USDC_E, data: ('0x095ea7b3' + '0'.repeat(120)) as `0x${string}`, value: '0' }
    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, env)
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    expect(() => executor.getPendingSummary()).toThrow(/Invalid ERC-20 approve calldata/)
    expect(executor.hasPendingTransaction()).toBe(false)
  })

  it('sequences approve → receipt-wait → wrap', async () => {
    const executor = new AgentExecutor(createMockVault())
    const order: string[] = []
    vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => {
      const to = extractNestedTx(envelope)?.to
      order.push(to)
      return {
        tx_hash: to === USDC_E ? '0xapprove' : '0xwrap',
        chain: 'Polygon',
        status: 'pending',
        explorer_url: `https://polygonscan.com/tx/${to}`,
      }
    })
    const receipt = vi.spyOn(executor as any, 'waitForEvmReceipt').mockResolvedValue(undefined)

    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapBundled())
    expect(executor.storeServerTransaction(wrapped)).toBe(true)
    const recent = await executor.signTxFromBuffer('call-1')

    expect(recent.success).toBe(true)
    expect(order).toEqual([USDC_E, ONRAMP])
    expect(receipt).toHaveBeenCalledTimes(1)
    expect(recent.data?.approval_tx_hash).toBe('0xapprove')
    expect(recent.data?.tx_hash).toBe('0xwrap')
  })

  it('fails closed: a receipt timeout holds back the wrap leg', async () => {
    const executor = new AgentExecutor(createMockVault())
    const signServerTx = vi.spyOn(executor as any, 'signServerTx').mockImplementation(async (envelope: any) => ({
      tx_hash: extractNestedTx(envelope)?.to === USDC_E ? '0xapprove' : '0xwrap',
      chain: 'Polygon',
      status: 'pending',
      explorer_url: 'https://polygonscan.com/tx/x',
    }))
    vi.spyOn(executor as any, 'waitForEvmReceipt').mockRejectedValue(new Error('receipt timeout'))

    const wrapped = buildTxReadyFromToolOutput(POLYMARKET_DEPOSIT_TOOL, depositWrapBundled())
    executor.storeServerTransaction(wrapped)
    const recent = await executor.signTxFromBuffer('call-1')

    expect(recent.success).toBe(false)
    // only the approve leg was ever signed; the wrap never broadcast
    expect(signServerTx).toHaveBeenCalledTimes(1)
  })
})
