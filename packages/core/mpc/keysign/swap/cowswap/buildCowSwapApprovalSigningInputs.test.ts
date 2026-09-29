import { create } from '@bufbuild/protobuf'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { EthereumSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { Erc20ApprovePayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/erc20_approve_payload_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { buildCowSwapApprovalSigningInputs } from './buildCowSwapApprovalSigningInputs'

const VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110'
const SENDER = '0x1234567890123456789012345678901234567890'
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'

const buildPayload = ({ approve }: { approve?: { resetAllowanceFirst: boolean } }) =>
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

const toBigInt = (bytes: Uint8Array | null | undefined) =>
  BigInt(`0x${Buffer.from(bytes ?? []).toString('hex') || '0'}`)

const describeLeg = (encoded: Uint8Array) => {
  const { nonce, toAddress, transaction } = TW.Ethereum.Proto.SigningInput.decode(encoded)

  return {
    nonce: toBigInt(nonce),
    toAddress,
    spender: transaction?.erc20Approve?.spender,
    amount: toBigInt(transaction?.erc20Approve?.amount),
  }
}

describe('buildCowSwapApprovalSigningInputs', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('encodes nothing when the payload carries no approval', () => {
    expect(
      buildCowSwapApprovalSigningInputs({
        keysignPayload: buildPayload({}),
        walletCore,
      })
    ).toEqual([])
  })

  it('encodes the single approve(VaultRelayer, amount) at the payload nonce when no reset is asked for', () => {
    const inputs = buildCowSwapApprovalSigningInputs({
      keysignPayload: buildPayload({ approve: { resetAllowanceFirst: false } }),
      walletCore,
    })

    expect(inputs.map(describeLeg)).toEqual([
      {
        nonce: 3n,
        toAddress: USDT,
        spender: VAULT_RELAYER,
        amount: 5_000_000n,
      },
    ])
  })

  it('encodes approve(0) then approve(amount) on consecutive nonces when the payload asks for a reset', () => {
    const inputs = buildCowSwapApprovalSigningInputs({
      keysignPayload: buildPayload({ approve: { resetAllowanceFirst: true } }),
      walletCore,
    })

    expect(inputs.map(describeLeg)).toEqual([
      { nonce: 3n, toAddress: USDT, spender: VAULT_RELAYER, amount: 0n },
      {
        nonce: 4n,
        toAddress: USDT,
        spender: VAULT_RELAYER,
        amount: 5_000_000n,
      },
    ])
  })
})
