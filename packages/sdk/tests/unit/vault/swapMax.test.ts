import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/mpc-types', () => ({ getMpcEngine: vi.fn() }))

import { VaultBase } from '@/vault/VaultBase'
import { VaultError, VaultErrorCode } from '@/vault/VaultError'

/**
 * `swap({ amount: 'max' })` used to resolve `max` to the FULL source balance and
 * then quote AND prepare with it, never consulting the `maxSwapable` its own
 * `getSwapQuote` computes. On a native swap that over-commits by exactly the
 * network fee: the caller is told the swap is viable, signs, and it fails at
 * prepare/broadcast with insufficient funds.
 *
 * These drive the real `VaultBase.swap` rather than the service mocks, because
 * the pre-existing `swap` tests in compound-wrappers.test.ts call the mocks
 * directly and so pass whether or not the wrapper honours the ceiling.
 */

type QuoteCall = { amount: string }

function makeVault(opts: {
  balance: bigint
  decimals: number
  maxSwapable: bigint | ((amount: string) => bigint)
  contractAddress?: string
  ticker?: string
}) {
  const quoteCalls: QuoteCall[] = []
  const prepareCalls: QuoteCall[] = []

  const getSwapQuote = vi.fn(async ({ amount }: { amount: string }) => {
    quoteCalls.push({ amount })
    const maxSwapable = typeof opts.maxSwapable === 'function' ? opts.maxSwapable(amount) : opts.maxSwapable
    return { bestQuote: { provider: 'thorchain' }, balance: opts.balance, maxSwapable, warnings: [] }
  })

  const prepareSwapTx = vi.fn(async ({ amount }: { amount: string }) => {
    prepareCalls.push({ amount })
    return { keysignPayload: { chain: Chain.Ethereum }, approvalPayload: undefined }
  })

  const getBalance = vi.fn(async () => ({ amount: opts.balance.toString() }))

  const vault = Object.create(VaultBase.prototype) as VaultBase
  Object.assign(vault as object, {
    balanceService: { getBalance },
    // Own properties shadow the prototype methods, so `swap` exercises its own
    // logic while every collaborator is a mock.
    resolveTokenInfo: vi.fn(() => ({
      ticker: opts.ticker ?? 'ETH',
      decimals: opts.decimals,
      contractAddress: opts.contractAddress,
    })),
    address: vi.fn(async () => '0xSender'),
    buildAccountCoin: vi.fn(() => ({ chain: Chain.Ethereum, address: '0xSender' })),
    getSwapQuote,
    prepareSwapTx,
    extractMessageHashes: vi.fn(async () => ['0xhash']),
    sign: vi.fn(async () => ({ signature: 'sig', format: 'ECDSA' })),
    broadcastTx: vi.fn(async () => '0xTxHash'),
    waitForConfirmation: vi.fn(async () => undefined),
  })

  return { vault, getSwapQuote, prepareSwapTx, getBalance, quoteCalls, prepareCalls }
}

const swapParams = {
  fromChain: Chain.Ethereum,
  fromSymbol: 'ETH',
  toChain: Chain.Bitcoin,
  toSymbol: 'BTC',
  amount: 'max',
}

describe('VaultBase.swap({ amount: "max" }) honours the fee-aware ceiling', () => {
  beforeEach(() => vi.clearAllMocks())

  it('quotes AND prepares at maxSwapable, not the full balance, for a native swap', async () => {
    const balance = 1_000_000_000_000_000_000n // 1.0 ETH
    const max = 999_000_000_000_000_000n // 0.999 ETH after a 0.001 network fee
    const { vault, quoteCalls, prepareCalls } = makeVault({ balance, decimals: 18, maxSwapable: max })

    await vault.swap(swapParams)

    // The probe runs at the full balance (that is how maxSwapable is learned),
    // but nothing is committed at that amount.
    expect(quoteCalls[0]!.amount).toBe('1.0')
    expect(quoteCalls.at(-1)!.amount).toBe('0.999')
    // The one that actually matters: prepare must not see the full balance.
    expect(prepareCalls).toHaveLength(1)
    expect(prepareCalls[0]!.amount).toBe('0.999')
  })

  it('fails closed when the route cannot price its source-chain fee (maxSwapable 0n)', async () => {
    const { vault, prepareSwapTx } = makeVault({
      balance: 100_000_000n,
      decimals: 8,
      maxSwapable: 0n, // deposit-channel / transfer route
      ticker: 'BTC',
    })

    await expect(vault.swap(swapParams)).rejects.toThrow(VaultError)
    await expect(vault.swap(swapParams)).rejects.toThrow(/only known at\s+broadcast time|broadcast time/)
    // Fail closed means nothing was built - not "built with a guessed fee".
    expect(prepareSwapTx).not.toHaveBeenCalled()

    try {
      await vault.swap(swapParams)
    } catch (e) {
      expect((e as VaultError).code).toBe(VaultErrorCode.InvalidAmount)
    }
  })

  it('reuses the probe quote for a token swap (whole balance swappable, no second quote)', async () => {
    const balance = 100_000_000n // 100 USDC
    const { vault, quoteCalls, prepareCalls } = makeVault({
      balance,
      decimals: 6,
      maxSwapable: balance, // gas is paid in the native asset
      contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      ticker: 'USDC',
    })

    await vault.swap(swapParams)

    // No re-quote: the ceiling IS the balance, so a second network round-trip
    // would buy nothing and risk a differing quote between check and commit.
    expect(quoteCalls).toHaveLength(1)
    expect(quoteCalls[0]!.amount).toBe('100.0')
    expect(prepareCalls[0]!.amount).toBe('100.0')
  })

  it('still rejects a zero balance before quoting anything', async () => {
    const { vault, getSwapQuote } = makeVault({ balance: 0n, decimals: 18, maxSwapable: 0n })
    await expect(vault.swap(swapParams)).rejects.toThrow(/Zero balance/)
    expect(getSwapQuote).not.toHaveBeenCalled()
  })

  it('leaves an explicit amount untouched and never fetches a balance', async () => {
    const { vault, getBalance, quoteCalls, prepareCalls } = makeVault({
      balance: 1_000_000_000_000_000_000n,
      decimals: 18,
      maxSwapable: 1n, // would be catastrophic if the max path ran here
    })

    await vault.swap({ ...swapParams, amount: '0.25' })

    expect(getBalance).not.toHaveBeenCalled()
    expect(quoteCalls).toEqual([{ amount: '0.25' }])
    expect(prepareCalls).toEqual([{ amount: '0.25' }])
  })

  it('does not commit the full balance on dryRun either', async () => {
    const balance = 1_000_000_000_000_000_000n
    const { vault } = makeVault({ balance, decimals: 18, maxSwapable: 990_000_000_000_000_000n })

    const out = (await vault.swap({ ...swapParams, dryRun: true })) as { dryRun: true; quote: unknown }

    expect(out.dryRun).toBe(true)
    // The returned quote is the fee-aware one, so a caller that renders it is
    // not shown a number larger than what would actually be swapped.
    expect((out.quote as { maxSwapable: bigint }).maxSwapable).toBe(990_000_000_000_000_000n)
  })
})
