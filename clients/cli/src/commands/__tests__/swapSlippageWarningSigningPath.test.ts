/**
 * bead vultisig-ehedh follow-up: the --slippage 0 warning previously only
 * surfaced on the dry-run return value. `swap --slippage 0` (without
 * --dry-run) reached the real preview/confirm/sign flow with no warning at
 * all, since `confirmSwapIfNeeded` never saw it. This test drives the actual
 * signing path (isJsonOutput: false, non-dry-run, auto-confirmed via --yes)
 * and asserts the same warning is surfaced there too, before the broadcast.
 */
import type { VaultBase } from '@vultisig/sdk'
import { Chain } from '@vultisig/sdk'
import { describe, expect, it, vi } from 'vitest'

const { warnMock, confirmSwapMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
  confirmSwapMock: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../lib/output', () => ({
  createSpinner: () => ({ succeed: vi.fn(), stop: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: warnMock,
  isNonInteractive: () => false,
  isJsonOutput: () => false,
  outputJson: vi.fn(),
}))
vi.mock('../../ui', () => ({
  confirmSwap: confirmSwapMock,
  displaySwapChains: vi.fn(),
  displaySwapPreview: vi.fn(),
  displaySwapResult: vi.fn(),
  formatBigintAmount: (v: bigint) => String(v),
}))
vi.mock('../../core/broadcastGuard', async importOriginal => {
  const actual = await importOriginal<typeof import('../../core/broadcastGuard')>()
  return {
    ...actual,
    buildSwapBroadcastIntent: vi.fn(() => ({})),
    guardedBroadcast: vi.fn(async (_intent: unknown, _force: boolean, fn: () => Promise<unknown>) => fn()),
  }
})
vi.mock('../../core/password-manager', async importOriginal => {
  const actual = await importOriginal<typeof import('../../core/password-manager')>()
  return { ...actual, ensureVaultUnlocked: vi.fn() }
})

import { executeSwap } from '../swap'

function makeSwapVault(txHash: string): VaultBase {
  const quote = {
    fromCoin: { decimals: 18, ticker: 'ETH' },
    toCoin: { decimals: 8, ticker: 'BTC' },
    estimatedOutput: 100n,
    maxSwapable: 0n,
    provider: 'thorchain',
  }
  const swap = vi.fn(async (p: { dryRun?: boolean }) => {
    if (p.dryRun) return { dryRun: true, quote }
    return { dryRun: false, txHash, chain: Chain.Ethereum, quote }
  })
  return {
    swap,
    balance: vi.fn().mockResolvedValue({ symbol: 'ETH', decimals: 18 }),
    getDiscountTier: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as VaultBase
}

function ctxFor(vault: VaultBase) {
  return { ensureActiveVault: vi.fn().mockResolvedValue(vault) } as never
}

describe('swap signing path — slippage=0 warning (bead ehedh)', () => {
  it('warns before the real broadcast when --slippage 0 reaches the sign flow, not just dry-run', async () => {
    warnMock.mockClear()
    const vault = makeSwapVault('0xsigned')

    const result = await executeSwap(ctxFor(vault), {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: '1',
      slippage: 0,
      yes: true,
    })

    expect(result).toMatchObject({ txHash: '0xsigned' })
    expect(warnMock).toHaveBeenCalledWith(expect.stringMatching(/slippage.*0.*revert|revert.*slippage.*0/i))
  })

  it('does NOT warn on the signing path when slippage is undefined or >0', async () => {
    warnMock.mockClear()
    const vault = makeSwapVault('0xsigned-no-warn')

    await executeSwap(ctxFor(vault), {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: '1',
      yes: true,
    })
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringMatching(/slippage.*0.*revert/i))

    const vault2 = makeSwapVault('0xsigned-no-warn-2')
    await executeSwap(ctxFor(vault2), {
      fromChain: Chain.Ethereum,
      toChain: Chain.Bitcoin,
      amount: '1',
      slippage: 1,
      yes: true,
    })
    expect(warnMock).not.toHaveBeenCalledWith(expect.stringMatching(/slippage.*0.*revert/i))
  })
})
