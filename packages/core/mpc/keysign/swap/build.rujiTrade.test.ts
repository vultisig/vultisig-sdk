import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import {
  THORChainSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getChainSpecific: vi.fn(async () => ({
    case: 'thorchainSpecific' as const,
    value: create(THORChainSpecificSchema, {
      accountNumber: 1n,
      sequence: 2n,
      fee: 2_000_000n,
      transactionType: TransactionType.GENERIC_CONTRACT,
    }),
  })),
  getKeysignUtxoInfo: vi.fn(async () => []),
}))

vi.mock('@vultisig/core-mpc/keysign/chainSpecific', () => ({ getChainSpecific: mocks.getChainSpecific }))
vi.mock('@vultisig/core-mpc/keysign/utxo/getKeysignUtxoInfo', () => ({
  getKeysignUtxoInfo: mocks.getKeysignUtxoInfo,
}))

import { buildSwapKeysignPayload } from './build'

const address = 'thor1vk6trmz42cjrh4zcxczeaacnsv3snv4f22x8ccu203dqde7vtaxsyevlec'
const publicKey = { data: () => new Uint8Array([1, 2, 3]) } as never

const buildInput = {
  fromCoin: { chain: Chain.THORChain, address, ticker: 'RUNE', decimals: 8 },
  toCoin: { chain: Chain.THORChain, address, id: 'x/brune', ticker: 'bRUNE', decimals: 8 },
  amount: 1,
  vaultId: 'vault-id',
  localPartyId: 'local-party',
  fromPublicKey: publicKey,
  toPublicKey: publicKey,
  libType: 'DKLS' as const,
  walletCore: {} as never,
}

const makeQuote = (denom = 'rune'): SwapQuote => ({
  discounts: [],
  quote: {
    general: {
      provider: 'ruji',
      dstAmount: '998124',
      tx: {
        cosmosWasm: {
          sender: address,
          contract: address,
          executeMsg: JSON.stringify({ swap: { min: { min_return: '988142', to: address } } }),
          funds: [{ denom, amount: '1000000' }],
        },
      },
    },
  },
})

describe('buildSwapKeysignPayload RUJI Trade', () => {
  beforeEach(() => {
    mocks.getChainSpecific.mockClear()
  })

  it('builds a GENERIC_CONTRACT payload that signs the exact FIN execute message and funds', async () => {
    const payload = await buildSwapKeysignPayload({ ...buildInput, swapQuote: makeQuote() })

    expect(payload.toAddress).toBe(address)
    expect(payload.toAmount).toBe('1000000')
    expect(payload.contractPayload).toMatchObject({
      case: 'wasmExecuteContractPayload',
      value: {
        senderAddress: address,
        contractAddress: address,
        executeMsg: JSON.stringify({ swap: { min: { min_return: '988142', to: address } } }),
        coins: [{ denom: 'rune', amount: '1000000' }],
      },
    })
    expect(payload.swapPayload).toMatchObject({
      case: 'oneinchSwapPayload',
      value: {
        provider: 'ruji',
        fromAmount: '1000000',
        quote: { tx: { to: address, value: '1000000' } },
      },
    })
    expect(mocks.getChainSpecific).toHaveBeenCalledWith(
      expect.objectContaining({ transactionType: TransactionType.GENERIC_CONTRACT })
    )
  })

  it('fails closed when the attached denom does not match the source coin', async () => {
    await expect(buildSwapKeysignPayload({ ...buildInput, swapQuote: makeQuote('x/brune') })).rejects.toThrow(
      'exactly one rune fund'
    )
    expect(mocks.getChainSpecific).not.toHaveBeenCalled()
  })
})
