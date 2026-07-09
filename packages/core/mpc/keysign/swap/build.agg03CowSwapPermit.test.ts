import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { COW_VAULT_RELAYER_ADDRESS } from '@vultisig/core-chain/swap/general/cowswap/config'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { describe, expect, it, vi } from 'vitest'

// AGG-03 (round-2 spec-level fund-safety audit): `permitRequired` is computed and
// serialized into the CowSwap keysign payload's `data` field to signal that a
// permit-eligible token (e.g. USDC) COULD one day settle via a gasless EIP-2612
// permit instead of an on-chain approve. But the permit path is not wired yet:
// `buildEip2612Permit` has zero callers and no permit digest reaches the MPC
// keysign payload. Until that path lands, the on-chain approve is LOAD-BEARING —
// skipping it would leave the order with neither approve nor permit, so the
// solver could not pull the sell token and the order would silently never settle.
// These tests therefore assert that a permit-flagged CowSwap order STILL obtains
// its allowance via the approve (allowance-is-obtainable), not merely that the
// approve is skipped.
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'

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
  getErc20Allowance: vi.fn(async () => 0n), // insufficient allowance — would force the approve branch if not skipped
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

const cowSwapOrder = (overrides: { permitRequired?: true } = {}) => ({
  sellToken: '0xusdc',
  buyToken: '0xdai',
  receiver: '0xreceiver',
  sellAmount: '990000000',
  buyAmount: '990000000000000000',
  validTo: Math.floor(Date.now() / 1000) + 900,
  appData: '{}',
  appDataHash: '0x' + '00'.repeat(32),
  feeAmount: '10000000',
  kind: 'sell' as const,
  partiallyFillable: false,
  sellTokenBalance: 'erc20' as const,
  buyTokenBalance: 'erc20' as const,
  chainId: 1,
  apiBase: 'https://api.cow.fi/mainnet',
  ...overrides,
})

const baseArgs = {
  fromCoin: { chain: Chain.Ethereum, address: '0xsender', id: '0xusdc', ticker: 'USDC', decimals: 6 },
  toCoin: { chain: Chain.Ethereum, address: '0xdai', id: '0xdai', ticker: 'DAI', decimals: 18 },
  amount: 990,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
}

describe('buildSwapKeysignPayload — AGG-03: CowSwap permitRequired keeps the approve until the EIP-2612 permit path is wired', () => {
  it('STILL obtains allowance via an erc20ApprovePayload for a CowSwap order flagged permitRequired (permit path unwired, so the approve is load-bearing)', async () => {
    mocks.getErc20Allowance.mockClear()

    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: 'cowswap',
          dstAmount: '990000000000000000',
          tx: { cowswap_order: cowSwapOrder({ permitRequired: true }) },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({ ...baseArgs, swapQuote })

    expect(payload.toAddress).toBe(COW_VAULT_RELAYER_ADDRESS)
    // Until buildEip2612Permit is wired, a permit-flagged order MUST still obtain
    // allowance via the on-chain approve, otherwise the solver cannot pull the
    // sell token and the order silently never settles.
    expect(payload.erc20ApprovePayload?.spender).toBe(COW_VAULT_RELAYER_ADDRESS)
    expect(mocks.getErc20Allowance).toHaveBeenCalledWith(
      expect.objectContaining({ chain: Chain.Ethereum, address: '0xsender', spender: COW_VAULT_RELAYER_ADDRESS })
    )
  })

  it('still builds an erc20ApprovePayload for a CowSwap order WITHOUT permitRequired, when allowance is insufficient', async () => {
    mocks.getErc20Allowance.mockClear()

    const swapQuote: SwapQuote = {
      quote: {
        general: {
          provider: 'cowswap',
          dstAmount: '990000000000000000',
          tx: { cowswap_order: cowSwapOrder() },
        },
      },
      discounts: [],
    } as never

    const payload = await buildSwapKeysignPayload({ ...baseArgs, swapQuote })

    expect(payload.toAddress).toBe(COW_VAULT_RELAYER_ADDRESS)
    expect(payload.erc20ApprovePayload?.spender).toBe(COW_VAULT_RELAYER_ADDRESS)
    expect(mocks.getErc20Allowance).toHaveBeenCalledWith(
      expect.objectContaining({ chain: Chain.Ethereum, address: '0xsender', spender: COW_VAULT_RELAYER_ADDRESS })
    )
  })

  it('regression: a non-CowSwap EVM swap (1inch) still builds a real approve, unaffected by CowSwap permit handling', async () => {
    mocks.getErc20Allowance.mockClear()

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

    const payload = await buildSwapKeysignPayload({ ...baseArgs, swapQuote })

    expect(payload.erc20ApprovePayload?.spender).toBe(ONE_INCH_V6_ROUTER)
    expect(mocks.getErc20Allowance).toHaveBeenCalledWith(
      expect.objectContaining({ chain: Chain.Ethereum, address: '0xsender', spender: ONE_INCH_V6_ROUTER })
    )
  })
})
