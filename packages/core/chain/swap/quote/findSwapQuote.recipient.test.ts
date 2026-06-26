import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SwapErrorCode } from '../SwapError'
import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({
  getCowSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

// A valid 40-hex EVM address (checksummed form is also accepted by the regex)
const recipient = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

const erc20A = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xsrc',
  decimals: 18,
  ticker: 'SRC',
}
const erc20B = {
  chain: Chain.Ethereum,
  address: '0xsender',
  id: '0xdst',
  decimals: 6,
  ticker: 'DST',
}

const generalQuote = {
  dstAmount: '10000000',
  provider: 'kyber',
  tx: { evm: { from: '0xsender', to: '0xrouter', data: '0x', value: '0' } },
} as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findSwapQuote external recipient', () => {
  it('routes the output to the recipient via CowSwap and skips initiator-paying aggregators', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(generalQuote)
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, recipient })

    expect(getCowSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ receiver: recipient }))
    expect(getKyberSwapQuote).not.toHaveBeenCalled()
    expect(getOneInchSwapQuote).not.toHaveBeenCalled()
    expect(getLifiSwapQuote).not.toHaveBeenCalled()
    expect(getSwapKitQuote).not.toHaveBeenCalled()
  })

  it('passes the recipient as the native swap destination', async () => {
    vi.mocked(getNativeSwapQuote).mockResolvedValue({
      expected_amount_out: '10000000',
      swapChain: Chain.THORChain,
    } as never)

    await findSwapQuote({
      from: { chain: Chain.Bitcoin, address: 'bc1qsender', decimals: 8, ticker: 'BTC' },
      to: { chain: Chain.Ethereum, address: '0xsender', decimals: 18, ticker: 'ETH' },
      amount: 1_000_000n,
      recipient,
    })

    expect(getNativeSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ destination: recipient }))
  })

  it('keeps aggregators available when no recipient is set (no behavior change)', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(generalQuote)
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('skip cow'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n })

    expect(getKyberSwapQuote).toHaveBeenCalled()
  })

  it('uses the own address as native destination when no recipient is set', async () => {
    vi.mocked(getNativeSwapQuote).mockResolvedValue({
      expected_amount_out: '10000000',
      swapChain: Chain.THORChain,
    } as never)

    await findSwapQuote({
      from: { chain: Chain.Bitcoin, address: 'bc1qsender', decimals: 8, ticker: 'BTC' },
      to: { chain: Chain.Ethereum, address: '0xowner', decimals: 18, ticker: 'ETH' },
      amount: 1_000_000n,
    })

    expect(getNativeSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ destination: '0xowner' }))
  })

  it('treats a blank/whitespace recipient as no recipient (keeps aggregators, falls back to own address)', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue(generalQuote)
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getCowSwapQuote).mockResolvedValue(generalQuote)
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, recipient: '   ' })

    // Initiator-paying aggregator stays available rather than being gated off.
    expect(getKyberSwapQuote).toHaveBeenCalled()
    // CowSwap falls back to the sender's own address, not the blank string.
    expect(getCowSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ receiver: erc20A.address }))
  })

  it('throws InvalidConfig early when recipient is a malformed EVM address on a CowSwap-reachable pair', async () => {
    // None of the provider mocks should be called — the guard fires before any fetcher is built.
    await expect(
      findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, recipient: 'not-an-evm-address' })
    ).rejects.toMatchObject({
      code: SwapErrorCode.InvalidConfig,
      message: expect.stringContaining('not a valid EVM address'),
    })

    expect(getCowSwapQuote).not.toHaveBeenCalled()
    expect(getKyberSwapQuote).not.toHaveBeenCalled()
    expect(getOneInchSwapQuote).not.toHaveBeenCalled()
    expect(getLifiSwapQuote).not.toHaveBeenCalled()
    expect(getSwapKitQuote).not.toHaveBeenCalled()
  })

  it('throws InvalidConfig early when recipient is a too-short 0x string on a CowSwap-reachable pair', async () => {
    await expect(
      findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, recipient: '0xDEAD' })
    ).rejects.toMatchObject({ code: SwapErrorCode.InvalidConfig })

    expect(getCowSwapQuote).not.toHaveBeenCalled()
  })

  it('accepts a valid 40-hex EVM address and forwards it to CowSwap as receiver', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(generalQuote)
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

    await findSwapQuote({ from: erc20A, to: erc20B, amount: 1_000_000n, recipient })

    expect(getCowSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ receiver: recipient }))
  })

  it('does NOT enforce EVM format for cross-chain native-only pairs (THOR node validates downstream)', async () => {
    // BTC→ETH through THORChain: no ERC-20 id on from, so CowSwap path is unreachable.
    // A non-EVM recipient string (e.g. a THORName or bech32) should not be rejected here.
    vi.mocked(getNativeSwapQuote).mockResolvedValue({
      expected_amount_out: '10000000',
      swapChain: Chain.THORChain,
    } as never)

    await expect(
      findSwapQuote({
        from: { chain: Chain.Bitcoin, address: 'bc1qsender', decimals: 8, ticker: 'BTC' },
        to: { chain: Chain.Ethereum, address: '0xowner', decimals: 18, ticker: 'ETH' },
        amount: 1_000_000n,
        recipient: 'maya1someaddress',
      })
    ).resolves.toBeDefined()
  })
})
