import { scanAddressWithBlockaid } from '@vultisig/core-chain/security/blockaid/address'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// LI.FI documents `estimate.approvalAddress` as route-dependent. The official
// Diamond is accepted deterministically; a distinct spender must clear an
// independent reputation boundary before it reaches the approval payload.

const fixture = vi.hoisted(() => ({
  approvalAddress: undefined as string | undefined,
}))

// jscpd:ignore-start — the LiFi module-mock + fixture scaffolding below is intentionally
// shared with getLifiSwapQuote.routerTelemetry.test.ts (same core module under test); the
// meaningful assertions are the approvalAddress cases further down.
vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createClient: () => ({ config: {}, providers: [] }),
  getQuote: () =>
    Promise.resolve({
      transactionRequest: {
        value: '0',
        gasLimit: '0',
        data: '0x',
        from: '0xfrom',
        to: '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE', // official LI.FI Diamond
        chainId: 1,
      },
      estimate: {
        toAmount: '999000',
        gasCosts: [{ amount: '0' }],
        feeCosts: [{ name: 'LIFI Fixed Fee', amount: '0', token: { decimals: 6, address: 'USDT', chainId: 1 } }],
        ...(fixture.approvalAddress !== undefined ? { approvalAddress: fixture.approvalAddress } : {}),
      },
    }),
}))
vi.mock('@vultisig/core-chain/security/blockaid/address', () => ({ scanAddressWithBlockaid: vi.fn() }))
vi.mock('@vultisig/core-chain/ChainKind', () => ({
  getChainKind: () => 'evm',
  DeriveChainKind: {},
}))
vi.mock('@vultisig/core-chain/chains/solana/solanaConfig', () => ({
  solanaConfig: { ataRentLamports: 0 },
}))
vi.mock('@vultisig/core-chain/coin/chainFeeCoin', () => ({
  chainFeeCoin: new Proxy({}, { get: () => ({ ticker: 'ETH', id: 'ETH' }) }),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/LifiSwapEnabledChains', () => ({
  lifiSwapChainId: new Proxy({}, { get: () => 1 }),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing', () => ({
  injectSolanaAtaIfMissing: () => ({ data: '', ataInjected: false }),
}))
vi.mock('@vultisig/lib-utils/assert/shouldBePresent', () => ({
  shouldBePresent: <T>(v: T): T => v,
}))
vi.mock('@vultisig/lib-utils/match', () => ({
  match: (_kind: string, handlers: Record<string, () => unknown>) => handlers.evm(),
}))
vi.mock('@vultisig/lib-utils/memoize', () => ({
  memoize: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
}))
vi.mock('@vultisig/lib-utils/record/mirrorRecord', () => ({
  mirrorRecord: () => ({}),
}))
vi.mock('@vultisig/lib-utils/TransferDirection', () => ({
  TransferDirection: { from: 'from', to: 'to' },
}))

const baseInput = {
  from: { id: 'USDC', chain: 'Ethereum', address: '0xfrom', ticker: 'USDC' },
  to: { id: 'USDT', chain: 'Ethereum', address: '0xto', ticker: 'USDT' },
  amount: 1_000_000n,
  affiliateBps: 30,
}
// jscpd:ignore-end

const LIFI_DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
const INNER_EXECUTOR = '0x7f51c134000000000000000000000000000c7e11'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const mockScanAddressWithBlockaid = vi.mocked(scanAddressWithBlockaid)

const getEvmTx = async () => {
  const { getLifiSwapQuote } = await import('./getLifiSwapQuote')
  const quote = await getLifiSwapQuote(baseInput as never)
  return (quote.tx as { evm: Record<string, unknown> }).evm
}

describe('getLifiSwapQuote — evm.approvalAddress exposure (#895)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    mockScanAddressWithBlockaid.mockReset()
    mockScanAddressWithBlockaid.mockResolvedValue({ resultType: 'Benign', features: ['trusted'] })
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })
  afterEach(() => {
    infoSpy.mockRestore()
    fixture.approvalAddress = undefined
  })

  it('threads the verified LI.FI Diamond approvalAddress onto evm.approvalAddress', async () => {
    fixture.approvalAddress = LIFI_DIAMOND
    const evm = await getEvmTx()
    expect(evm.approvalAddress).toBe(LIFI_DIAMOND)
    expect(mockScanAddressWithBlockaid).not.toHaveBeenCalled()
  })

  it('threads a distinct route spender only after an independent benign reputation verdict', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    const evm = await getEvmTx()

    expect(evm.approvalAddress).toBe(INNER_EXECUTOR)
    expect(mockScanAddressWithBlockaid).toHaveBeenCalledWith(INNER_EXECUTOR, 'ethereum')
  })

  it('rejects a distinct route spender when the independent verdict is not benign', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    mockScanAddressWithBlockaid.mockResolvedValueOnce({ resultType: 'Malicious', features: ['drainer'] })

    await expect(getEvmTx()).rejects.toThrow(/LI\.FI approval spender .*Malicious Blockaid verdict/i)
  })

  it('fails closed when a distinct route spender cannot be reputation-checked', async () => {
    fixture.approvalAddress = INNER_EXECUTOR
    mockScanAddressWithBlockaid.mockRejectedValueOnce(new Error('blockaid unreachable'))

    await expect(getEvmTx()).rejects.toThrow(/LI\.FI approval spender reputation check failed/i)
  })

  it('omits evm.approvalAddress for the zero address (native-only routes)', async () => {
    fixture.approvalAddress = ZERO_ADDRESS
    const evm = await getEvmTx()
    expect(evm).toBeDefined()
    expect(evm.approvalAddress).toBeUndefined()
  })

  it('omits evm.approvalAddress when the estimate carries none', async () => {
    fixture.approvalAddress = undefined
    const evm = await getEvmTx()
    expect(evm).toBeDefined()
    expect(evm.approvalAddress).toBeUndefined()
  })
})
