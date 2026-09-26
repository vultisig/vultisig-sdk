import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { encodeFunctionData, parseAbi } from 'viem'
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
      maxSlippageBps: 50,
      dstAmount: '1000000',
      tx: { evm: { from: '0xsender', to: '0xrouter', data: '0xdeadbeef', value: '0' } },
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

describe('buildSwapKeysignPayload minimum output boundary', () => {
  const sender = '0x0000000000000000000000000000000000000001'
  const asset = '0x0000000000000000000000000000000000000002'
  const attacker = '0x0000000000000000000000000000000000000003'
  const abi = parseAbi([
    'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
  ])
  const data = (minimum: bigint, dstToken = asset, dstReceiver = sender) =>
    encodeFunctionData({
      abi,
      functionName: 'swap',
      args: [
        sender,
        {
          srcToken: sender,
          dstToken: dstToken as `0x${string}`,
          srcReceiver: sender,
          dstReceiver: dstReceiver as `0x${string}`,
          amount: 1_000_000n,
          minReturnAmount: minimum,
          flags: 0n,
        },
        '0x',
      ],
    })

  it('builds honest known calldata and stops one-wei calldata before a keysign payload exists', async () => {
    const quote = (minimum: bigint, dstToken = asset, dstReceiver = sender): SwapQuote =>
      ({
        ...swapQuote,
        quote: {
          general: {
            provider: '1inch',
            dstAmount: '1000000',
            maxSlippageBps: 50,
            tx: { evm: { from: sender, to: '0xrouter', value: '0', data: data(minimum, dstToken, dstReceiver) } },
          },
        },
      }) as SwapQuote

    const input = {
      ...buildInput,
      fromCoin: { ...buildInput.fromCoin, address: sender },
      toCoin: { ...buildInput.toCoin, address: sender, id: asset },
    }
    const honest = await buildSwapKeysignPayload({ ...input, swapQuote: quote(995_000n) })
    expect(honest.swapPayload?.case).toBe('oneinchSwapPayload')
    await expect(buildSwapKeysignPayload({ ...input, swapQuote: quote(1n) })).rejects.toThrow(
      /below the quote-bound floor/
    )
    await expect(buildSwapKeysignPayload({ ...input, swapQuote: quote(995_000n, attacker) })).rejects.toThrow(
      /destination asset/
    )
    await expect(buildSwapKeysignPayload({ ...input, swapQuote: quote(995_000n, asset, attacker) })).rejects.toThrow(
      /output receiver/
    )
  })
})
