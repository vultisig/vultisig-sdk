/**
 * Coverage for the `isNativeSend` gate in getCosmosChainSpecific: it decides
 * whether the initiator simulates and relays `CosmosSpecific.gas_limit`.
 * `estimateCosmosGasLimit` is mocked so these assert only the branching (which
 * txs get a relayed limit), not the live simulate/WalletCore path.
 */
import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import {
  CosmosSpecificSchema,
  TransactionType,
} from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { SignAminoSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/wasm_execute_contract_payload_pb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vultisig/core-chain/chains/cosmos/account/getCosmosAccountInfo', () => ({
  getCosmosAccountInfo: vi.fn().mockResolvedValue({
    accountNumber: 7n,
    sequence: 3,
    sequenceBigInt: 3n,
    latestBlock: '1234567_0',
  }),
}))

vi.mock('@vultisig/core-chain/chains/cosmos/gas', () => ({
  getCosmosFeeAmount: vi.fn().mockResolvedValue(7500n),
}))

vi.mock('./gasEstimation/estimateCosmosGasLimit', () => ({
  estimateCosmosGasLimit: vi.fn(),
}))

import { estimateCosmosGasLimit } from './gasEstimation/estimateCosmosGasLimit.js'
import { getCosmosChainSpecific } from './index.js'

const RELAYED = 130_000n

const walletCore = {} as any

type PayloadOverrides = {
  contractAddress?: string
  toAddress?: string
  toAmount?: string
  signData?: any
}

const buildPayload = ({
  contractAddress = '',
  toAddress = 'cosmos1recipient',
  toAmount = '12345',
  signData,
}: PayloadOverrides = {}) => {
  const payload = create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Cosmos,
      ticker: 'ATOM',
      address: 'cosmos1sender',
      contractAddress,
      decimals: 6,
      isNativeToken: !contractAddress,
      hexPublicKey: '02'.padEnd(66, '0'),
    }),
    toAddress,
    toAmount,
    blockchainSpecific: {
      case: 'cosmosSpecific',
      value: create(CosmosSpecificSchema, {}),
    },
  })
  if (signData) {
    payload.signData = signData
  }
  return payload
}

const resolve = (payload: ReturnType<typeof buildPayload>, transactionType = TransactionType.UNSPECIFIED) =>
  getCosmosChainSpecific({
    keysignPayload: payload,
    walletCore,
    transactionType,
  })

describe('getCosmosChainSpecific — isNativeSend gate', () => {
  beforeEach(() => {
    vi.mocked(estimateCosmosGasLimit).mockReset().mockResolvedValue(RELAYED)
  })

  it('simulates and relays gas_limit for a native bank send', async () => {
    const result = await resolve(buildPayload())

    expect(estimateCosmosGasLimit).toHaveBeenCalledOnce()
    expect(result.gasLimit).toBe(RELAYED)
  })

  it('leaves gas_limit unset for a token (non-fee-coin) send', async () => {
    const result = await resolve(buildPayload({ contractAddress: 'uxyz' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset for an IBC transfer', async () => {
    const result = await resolve(buildPayload(), TransactionType.IBC_TRANSFER)

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset for a generic contract tx', async () => {
    const result = await resolve(buildPayload(), TransactionType.GENERIC_CONTRACT)

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset when a dapp relays signData', async () => {
    const result = await resolve(
      buildPayload({
        signData: { case: 'signAmino', value: create(SignAminoSchema, {}) },
      })
    )

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset for a zero-amount send', async () => {
    const result = await resolve(buildPayload({ toAmount: '0' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('leaves gas_limit unset when there is no recipient', async () => {
    const result = await resolve(buildPayload({ toAddress: '' }))

    expect(estimateCosmosGasLimit).not.toHaveBeenCalled()
    expect(result.gasLimit).toBeUndefined()
  })

  it('keeps gas_limit unset when the estimator fails closed (returns undefined)', async () => {
    vi.mocked(estimateCosmosGasLimit).mockResolvedValue(undefined)

    const result = await resolve(buildPayload())

    expect(estimateCosmosGasLimit).toHaveBeenCalledOnce()
    expect(result.gasLimit).toBeUndefined()
  })
})
