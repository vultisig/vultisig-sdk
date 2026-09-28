import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildCowSwapApprovalSigningInput } from './buildCowSwapApprovalSigningInput'
import { buildCowSwapApprovalSigningInputs } from './buildCowSwapApprovalSigningInputs'

// The single-input form is the subpath consumers on the 3.x line import. It must keep
// resolving and keep answering the common single-leg case exactly like the new builder,
// and must refuse the two-leg reset case rather than hand back only one of the approves.
const VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'

const buildPayload = ({ approve }: { approve?: { resetAllowanceFirst: boolean } }) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Ethereum,
      ticker: 'USDT',
      address: '0x1234567890123456789012345678901234567890',
      decimals: 6,
      contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      isNativeToken: false,
    }),
    blockchainSpecific: {
      case: 'ethereumSpecific',
      value: create(EthereumSpecificSchema, {
        maxFeePerGasWei: '1000000000',
        priorityFee: '100000000',
        nonce: 3n,
        gasLimit: '60000',
      }),
    },
    ...(approve
      ? {
          erc20ApprovePayload: create(Erc20ApprovePayloadSchema, {
            amount: '5000000',
            spender: VAULT_RELAYER,
            ...approve,
          }),
        }
      : {}),
  })

describe('buildCowSwapApprovalSigningInput (deprecated single-leg form)', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('returns undefined when the payload carries no approval', () => {
    expect(
      buildCowSwapApprovalSigningInput({
        keysignPayload: buildPayload({}),
        walletCore,
      })
    ).toBeUndefined()
  })

  it('returns the one leg the multi-leg builder produces when no reset is asked for', () => {
    const keysignPayload = buildPayload({
      approve: { resetAllowanceFirst: false },
    })

    const single = buildCowSwapApprovalSigningInput({
      keysignPayload,
      walletCore,
    })
    const [only, ...rest] = buildCowSwapApprovalSigningInputs({
      keysignPayload,
      walletCore,
    })

    expect(rest).toEqual([])
    expect(single).toEqual(only)
  })

  it('refuses a payload that asks for the reset instead of dropping a leg', () => {
    const keysignPayload = buildPayload({
      approve: { resetAllowanceFirst: true },
    })

    expect(() => buildCowSwapApprovalSigningInput({ keysignPayload, walletCore })).toThrow(
      /buildCowSwapApprovalSigningInputs/
    )
  })
})
