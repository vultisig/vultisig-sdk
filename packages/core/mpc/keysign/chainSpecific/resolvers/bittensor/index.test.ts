import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'
import { BuildKeysignPayloadError } from '../../../error'

const SENDER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const DEST_FUNDED = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const DEST_EMPTY = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const GENESIS_HASH = '0x2f0555cc76fc2840a25a6ea3b9637146806f1f44b090c175ffde2a7e5ab36c03'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  getBittensorCoinBalance: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

vi.mock('@vultisig/core-chain/coin/balance/resolvers/bittensor', () => ({
  getBittensorCoinBalance: mocks.getBittensorCoinBalance,
}))

// The fee refinement (payment_queryInfo) is exercised by its own path; here it
// is kept out of the way so a refine failure cannot mask the destination check.
vi.mock('./refine', () => ({
  refineBittensorChainSpecific: vi.fn(async ({ chainSpecific }) => chainSpecific),
}))

import { getBittensorChainSpecific } from './index'

const rpcResults: Record<string, unknown> = {
  state_getRuntimeVersion: { specVersion: 458, transactionVersion: 1 },
  chain_getHeader: { number: '0x3d0900' },
}

const payload = (toAddress: string, toAmount: string) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Bittensor,
      ticker: 'TAO',
      address: SENDER,
      decimals: 9,
      isNativeToken: true,
    }),
    toAddress,
    toAmount,
  })

const resolve = (toAddress: string, toAmount: string) =>
  getBittensorChainSpecific({ keysignPayload: payload(toAddress, toAmount), walletCore: {} as never })

describe('getBittensorChainSpecific — destination must end up at or above the existential deposit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryUrl.mockImplementation(
      async (_url: string, { body }: { body: { method: string; params: unknown[] } }) => {
        if (body.method === 'chain_getBlockHash') {
          return { jsonrpc: '2.0', id: 1, result: body.params[0] === 0 ? GENESIS_HASH : BLOCK_HASH }
        }
        if (body.method === 'system_accountNextIndex') {
          return { jsonrpc: '2.0', id: 1, result: 7 }
        }
        return { jsonrpc: '2.0', id: 1, result: rpcResults[body.method] }
      }
    )
    mocks.getBittensorCoinBalance.mockImplementation(async ({ address }: { address: string }) =>
      address === DEST_EMPTY ? 0n : 1_000_000_000n
    )
  })

  it('builds the chain-specific fields for an ordinary send without reading the destination', async () => {
    const result = await resolve(DEST_EMPTY, '1000000000')

    expect(result.nonce).toBe(7n)
    expect(result.currentBlockNumber).toBe('4000000')
    expect(result.specVersion).toBe(458)
    expect(result.genesisHash).toBe(GENESIS_HASH)
    expect(result.recentBlockHash).toBe(BLOCK_HASH)
    expect(result.gas).toBe(bittensorConfig.fee)
    expect(mocks.getBittensorCoinBalance).not.toHaveBeenCalled()
  })

  // Bittensor refuses to create an account below 500 rao, so a dust send to an
  // empty destination is doomed on-chain — reject it before the ceremony.
  it('rejects a sub-deposit amount to an empty destination', async () => {
    await expect(resolve(DEST_EMPTY, '499')).rejects.toMatchObject({
      name: 'BuildKeysignPayloadError',
      type: 'bittensor-destination-below-existential-deposit',
    })
    await expect(resolve(DEST_EMPTY, '499')).rejects.toBeInstanceOf(BuildKeysignPayloadError)
  })

  it('accepts exactly the existential deposit to an empty destination', async () => {
    await expect(resolve(DEST_EMPTY, String(bittensorConfig.existentialDeposit))).resolves.toBeDefined()
  })

  it('accepts a sub-deposit amount to a destination that already holds the deposit', async () => {
    await expect(resolve(DEST_FUNDED, '1')).resolves.toBeDefined()
    expect(mocks.getBittensorCoinBalance).toHaveBeenCalledWith({ chain: Chain.Bittensor, address: DEST_FUNDED })
  })
})
