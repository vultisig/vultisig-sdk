import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
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

const swapQuote: SwapQuote = {
  quote: {
    general: {
      provider: '1inch',
      dstAmount: '1000000',
      tx: { evm: { from: '0xsender', to: '0xrouter', data: '0xabc', value: '0' } },
    },
  },
  discounts: [],
} as never

const buildInput = {
  fromCoin: { chain: Chain.Ethereum, address: '0xsender', ticker: 'ETH', decimals: 18 },
  toCoin: { chain: Chain.Ethereum, address: '0xdest', id: '0xusdc', ticker: 'USDC', decimals: 6 },
  amount: 1,
  swapQuote,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
}

describe('buildSwapKeysignPayload gas limit override', () => {
  it('overwrites ethereumSpecific.gasLimit with the explicit override', async () => {
    const payload = await buildSwapKeysignPayload({ ...buildInput, gasLimitOverride: 999_999n })

    expect(getBlockchainSpecificValue(payload.blockchainSpecific, 'ethereumSpecific').gasLimit).toBe('999999')
    // the 1inch write-back re-reads the (now overridden) gas limit
    expect(payload.swapPayload?.case === 'oneinchSwapPayload' && payload.swapPayload.value.quote?.tx?.gas).toBe(
      999_999n
    )
  })

  it('keeps the estimated gas limit when no override is given', async () => {
    const payload = await buildSwapKeysignPayload(buildInput)

    expect(getBlockchainSpecificValue(payload.blockchainSpecific, 'ethereumSpecific').gasLimit).toBe('50000')
  })

  it('ignores a zero override', async () => {
    const payload = await buildSwapKeysignPayload({ ...buildInput, gasLimitOverride: 0n })

    expect(getBlockchainSpecificValue(payload.blockchainSpecific, 'ethereumSpecific').gasLimit).toBe('50000')
  })
})
