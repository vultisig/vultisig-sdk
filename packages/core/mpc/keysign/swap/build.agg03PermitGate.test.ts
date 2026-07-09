import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// AGG-03 (round-2 spec-level fund-safety audit): GeneralSwapQuote.ts documents the intent
// -- a CowSwap order flagged permitRequired settles via a gasless EIP-2612 permit signature
// bundled into the order digest, NOT an on-chain approve() -- but build.ts's allowance-check
// block ran unconditionally with no permitRequired branch, so a permit token (e.g. USDC)
// still got a redundant erc20ApprovePayload, defeating the entire point of
// KNOWN_PERMIT_TOKENS (extra signing step + gas the gasless path exists to avoid).

const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'ethereumSpecific' as const,
    value: create(EthereumSpecificSchema, {
      maxFeePerGasWei: '1000000000',
      priorityFee: '100000000',
      nonce: 0n,
      gasLimit: '210000',
    }),
  })),
  getKeysignUtxoInfo: vi.fn(async () => []),
  // Force the "would build an approve" branch (allowance < chainAmount) so a passing test
  // proves the permitRequired gate is what skips it -- not a coincidental sufficient allowance.
  getErc20Allowance: vi.fn(async () => 0n),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mocks.getChainSpecific,
}))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))
vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: mocks.getErc20Allowance,
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

const baseCowswapOrder = {
  sellToken: '0xusdc',
  buyToken: '0xdai',
  receiver: '0xdest',
  sellAmount: '1000000',
  buyAmount: '999000000000000000',
  validTo: 9999999999,
  appData: '0xappdata',
  appDataHash: '0xappdatahash',
  feeAmount: '0',
  kind: 'sell' as const,
  partiallyFillable: false,
  sellTokenBalance: 'erc20' as const,
  buyTokenBalance: 'erc20' as const,
  chainId: 1,
  apiBase: 'https://api.cow.fi/mainnet',
}

const buildArgs = {
  fromCoin: { chain: Chain.Ethereum, address: '0xsender', id: '0xusdc', ticker: 'USDC', decimals: 6 },
  toCoin: { chain: Chain.Ethereum, address: '0xdest', id: '0xdai', ticker: 'DAI', decimals: 18 },
  amount: 1,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
}

describe('buildSwapKeysignPayload — AGG-03: CowSwap permitRequired gates the approve step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getChainSpecific.mockResolvedValue({
      case: 'ethereumSpecific' as const,
      value: create(EthereumSpecificSchema, {
        maxFeePerGasWei: '1000000000',
        priorityFee: '100000000',
        nonce: 0n,
        gasLimit: '210000',
      }),
    })
    mocks.getKeysignUtxoInfo.mockResolvedValue([])
    mocks.getErc20Allowance.mockResolvedValue(0n)
  })

  it('SKIPS the on-chain approve for a permitRequired CowSwap order (gasless permit path)', async () => {
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: 'cowswap',
          dstAmount: '999000000000000000',
          tx: { cowswap_order: { ...baseCowswapOrder, permitRequired: true } },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({ ...buildArgs, swapQuote })

    expect(payload.erc20ApprovePayload).toBeUndefined()
    expect(mocks.getErc20Allowance).not.toHaveBeenCalled()
  })

  it('does NOT skip the approve for a non-permit CowSwap order (no false negative)', async () => {
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: 'cowswap',
          dstAmount: '999000000000000000',
          tx: { cowswap_order: { ...baseCowswapOrder, permitRequired: false } },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({ ...buildArgs, swapQuote })

    expect(payload.erc20ApprovePayload).toBeDefined()
    expect(payload.erc20ApprovePayload?.spender).toBe(COW_VAULT_RELAYER)
    expect(mocks.getErc20Allowance).toHaveBeenCalledOnce()
  })

  it('does NOT skip the approve for a non-CowSwap provider (no over-tightening of unrelated providers)', async () => {
    const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: '1inch',
          dstAmount: '1000000',
          tx: { evm: { from: '0xsender', to: ONE_INCH_V6_ROUTER, data: '0xabc', value: '0' } },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({ ...buildArgs, swapQuote })

    expect(payload.erc20ApprovePayload).toBeDefined()
    expect(payload.erc20ApprovePayload?.spender).toBe(ONE_INCH_V6_ROUTER)
    expect(mocks.getErc20Allowance).toHaveBeenCalledOnce()
  })
})
