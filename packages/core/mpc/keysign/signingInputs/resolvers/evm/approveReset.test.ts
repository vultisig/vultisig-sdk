import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  OneInchQuoteSchema,
  OneInchSwapPayloadSchema,
  OneInchTransactionSchema,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/1inch_swap_payload_pb'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { TW } from '@trustwallet/wallet-core'
import { beforeAll, describe, expect, it } from 'vitest'

import { getEvmSigningInputs } from './index'

// sdk#695: USDT-style tokens revert on a non-zero -> non-zero approve, so a payload can ask every
// signer for an approve(0) reset first (commondata#111 `reset_allowance_first`). Every co-signer
// rebuilds the message list from the shared payload, so the leg count and the nonce each leg uses
// are the cross-device contract these cases pin down.
const ONE_INCH_V6_ROUTER = '0x111111125421ca6dc452d289314280a0f8842a65'
const SENDER = '0x1234567890123456789012345678901234567890'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

const buildPayload = ({ resetAllowanceFirst }: { resetAllowanceFirst: boolean }) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ethereum,
      ticker: 'USDT',
      address: SENDER,
      decimals: 6,
      contractAddress: USDT,
      isNativeToken: false,
    }),
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        maxFeePerGasWei: '1000000000',
        priorityFee: '100000000',
        nonce: 7n,
        gasLimit: '210000',
      }),
    },
    erc20ApprovePayload: create(Erc20ApprovePayloadSchema, {
      amount: '5000000',
      spender: ONE_INCH_V6_ROUTER,
      resetAllowanceFirst,
    }),
    swapPayload: {
      case: 'oneinchSwapPayload',
      value: create(OneInchSwapPayloadSchema, {
        provider: '1inch',
        quote: create(OneInchQuoteSchema, {
          tx: create(OneInchTransactionSchema, {
            to: ONE_INCH_V6_ROUTER,
            data: '0xabcdef',
            value: '0',
            gasPrice: '0',
            gas: 0n,
          }),
        }),
      }),
    },
  })

const toBigInt = (bytes: Uint8Array | null | undefined) =>
  BigInt(`0x${Buffer.from(bytes ?? []).toString('hex') || '0'}`)

const describeInput = (input: TW.Ethereum.Proto.ISigningInput) => ({
  nonce: toBigInt(input.nonce),
  toAddress: input.toAddress,
  approveAmount: input.transaction?.erc20Approve ? toBigInt(input.transaction.erc20Approve.amount) : undefined,
})

describe('getEvmSigningInputs — sdk#695 USDT zero-first approve reset', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('keeps the two-message shape (approve + swap) when the payload does not ask for a reset', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildPayload({ resetAllowanceFirst: false }),
      walletCore,
    })

    expect(inputs.map(describeInput)).toEqual([
      { nonce: 7n, toAddress: USDT, approveAmount: 5_000_000n },
      { nonce: 8n, toAddress: ONE_INCH_V6_ROUTER, approveAmount: undefined },
    ])
  })

  it('emits approve(0), approve(amount), then the swap on consecutive nonces when the payload asks for a reset', async () => {
    const inputs = await getEvmSigningInputs({
      keysignPayload: buildPayload({ resetAllowanceFirst: true }),
      walletCore,
    })

    expect(inputs.map(describeInput)).toEqual([
      { nonce: 7n, toAddress: USDT, approveAmount: 0n },
      { nonce: 8n, toAddress: USDT, approveAmount: 5_000_000n },
      { nonce: 9n, toAddress: ONE_INCH_V6_ROUTER, approveAmount: undefined },
    ])
    expect(inputs[0]?.transaction?.erc20Approve?.spender).toBe(ONE_INCH_V6_ROUTER)
    expect(inputs[1]?.transaction?.erc20Approve?.spender).toBe(ONE_INCH_V6_ROUTER)
  })
})
