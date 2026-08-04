import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { TonSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TW } from '@trustwallet/wallet-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEstimateTonFee, mockGetTonSigningInputs } = vi.hoisted(() => ({
  mockEstimateTonFee: vi.fn(),
  mockGetTonSigningInputs: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/ton/api', () => ({ estimateTonFee: mockEstimateTonFee }))
vi.mock('../../signingInputs/resolvers/ton', () => ({ getTonSigningInputs: mockGetTonSigningInputs }))

import { getTonFeeAmount, tonFeeAmountResolver } from './ton'

const SENDER = 'UQAqbua3_0G_7K_jgzhjJceolfT-TONGsY65wUoBUtZinP1w'
const RECEIVER = 'UQCXhTIYi7zucgALWCxYRAHjwJbLDyZVUZVOa-FzD7UA5P5O'

const buildInput = ({ token = false, isActiveDestination = false } = {}) => {
  const keysignPayload = create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ton,
      ticker: token ? 'USDT' : 'TON',
      address: SENDER,
      decimals: token ? 6 : 9,
      contractAddress: token ? 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' : '',
      isNativeToken: !token,
    }),
    toAddress: RECEIVER,
    toAmount: '1000',
    blockchainSpecific: {
      case: 'tonSpecific',
      value: create(TonSpecificSchema, { isActiveDestination }),
    },
  })

  const vector = () => ({ add: vi.fn(), delete: vi.fn() })
  const compiled = TW.TheOpenNetwork.Proto.SigningOutput.encode(
    TW.TheOpenNetwork.Proto.SigningOutput.create({ encoded: 'compiled-external-message-boc' })
  ).finish()
  const walletCore = {
    CoinType: { ton: 607 },
    DataVector: { create: vector },
    TransactionCompiler: { compileWithSignatures: vi.fn(() => compiled) },
  }
  const publicKey = { data: () => new Uint8Array(32).fill(7) }

  return { keysignPayload, walletCore, publicKey } as unknown as Parameters<typeof tonFeeAmountResolver>[0]
}

describe('tonFeeAmountResolver', () => {
  beforeEach(() => {
    mockEstimateTonFee.mockReset()
    mockGetTonSigningInputs.mockReset()
    mockGetTonSigningInputs.mockResolvedValue([TW.TheOpenNetwork.Proto.SigningInput.create()])
  })

  it('adds the toncenter network fee to the jetton attachment when that exceeds the floor', async () => {
    mockEstimateTonFee.mockResolvedValue(25_000_000n)

    await expect(tonFeeAmountResolver(buildInput({ token: true, isActiveDestination: false }))).resolves.toBe(
      125_000_000n
    )
    expect(mockEstimateTonFee).toHaveBeenCalledWith({
      address: SENDER,
      externalMessageBoc: 'compiled-external-message-boc',
    })
  })

  it('keeps the established floor when the dry-run quote is lower', async () => {
    mockEstimateTonFee.mockResolvedValue(1_000_000n)

    await expect(tonFeeAmountResolver(buildInput({ token: true, isActiveDestination: true }))).resolves.toBe(
      90_000_000n
    )
    await expect(tonFeeAmountResolver(buildInput({ token: true, isActiveDestination: false }))).resolves.toBe(
      110_000_000n
    )
  })

  it('uses the dry-run directly for native TON sends', async () => {
    mockEstimateTonFee.mockResolvedValue(15_000_000n)

    await expect(tonFeeAmountResolver(buildInput())).resolves.toBe(15_000_000n)
  })

  it('falls back conservatively when toncenter is unavailable', async () => {
    mockEstimateTonFee.mockRejectedValue(new Error('timeout'))

    await expect(tonFeeAmountResolver(buildInput({ token: true, isActiveDestination: false }))).resolves.toBe(
      110_000_000n
    )
  })

  it('preserves the native floor and distinguishes active from first-recipient jetton sends', () => {
    expect(getTonFeeAmount({ chain: Chain.Ton, ticker: 'TON' } as never)).toBe(10_000_000n)
    expect(getTonFeeAmount({ chain: Chain.Ton, ticker: 'USDT', id: 'jetton' } as never, true)).toBe(90_000_000n)
    expect(getTonFeeAmount({ chain: Chain.Ton, ticker: 'USDT', id: 'jetton' } as never, false)).toBe(110_000_000n)
  })
})
