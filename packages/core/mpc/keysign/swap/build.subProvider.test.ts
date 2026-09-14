import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'ethereumSpecific' as const,
    value: create(EthereumSpecificSchema, {
      maxFeePerGasWei: '1000000000',
      priorityFee: '100000000',
      nonce: 0n,
      gasLimit: '50000',
    }),
  })),
  getKeysignUtxoInfo: vi.fn(async () => []),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({
  getChainSpecific: mocks.getChainSpecific,
}))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))
vi.mock('@vultisig/core-chain/chains/evm/erc20/getErc20Allowance', () => ({
  getErc20Allowance: vi.fn(),
}))

import { buildSwapKeysignPayload } from './build'

const publicKey = {
  data: () => new Uint8Array([1, 2, 3]),
} as never

const buildInput = (routeProvider?: string) => ({
  fromCoin: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
  toCoin: { chain: Chain.Ethereum, address: '0xdest', id: '0xusdc', ticker: 'USDC', decimals: 6 },
  amount: 1,
  swapQuote: {
    quote: {
      general: {
        provider: 'swapkit',
        dstAmount: '1000000',
        ...(routeProvider ? { routeProvider } : {}),
        tx: { evm: { from: '0xsender', to: '0xrouter', data: '0xabc', value: '0' } },
      },
    },
    discounts: [],
  } as never as SwapQuote,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
})

describe('buildSwapKeysignPayload sub-provider', () => {
  it('carries the route an EVM aggregator swap took', async () => {
    // The initiator names the route off the live quote. Without it on the
    // payload, a co-signer reads a bare "SwapKit" for a swap the initiator
    // calls "SwapKit (NEAR)" (vultisig-windows#4362).
    const payload = await buildSwapKeysignPayload(buildInput('NEAR'))

    expect(payload.swapPayload?.case).toBe('oneinchSwapPayload')
    if (payload.swapPayload?.case === 'oneinchSwapPayload') {
      expect(payload.swapPayload.value.subProvider).toBe('NEAR')
    }
  })

  it('leaves the route empty for an aggregator that routes directly', async () => {
    const payload = await buildSwapKeysignPayload(buildInput())

    expect(payload.swapPayload?.case === 'oneinchSwapPayload' && payload.swapPayload.value.subProvider).toBe('')
  })
})
