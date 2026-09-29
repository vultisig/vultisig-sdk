import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
  refineBittensorChainSpecific: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

vi.mock('./refine', () => ({
  refineBittensorChainSpecific: mocks.refineBittensorChainSpecific,
}))

import { getBittensorChainSpecific } from './index'

const SENDER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const DESTINATION = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const GENESIS_HASH = '0x2f0555cc76fc2840a25a6ea3b9637146806f1f44b090c175ffde2a7e5ab36c03'

const rpcResults: Record<string, unknown> = {
  state_getRuntimeVersion: { specVersion: 458, transactionVersion: 1 },
  chain_getHeader: { number: '0x3d0900' },
  system_accountNextIndex: 7,
}

const keysignPayload = create(KeysignPayloadSchema, {
  coin: create(CoinSchema, {
    chain: Chain.Bittensor,
    ticker: 'TAO',
    address: SENDER,
    decimals: 9,
    isNativeToken: true,
  }),
  toAddress: DESTINATION,
  toAmount: '1000000000',
})

describe('getBittensorChainSpecific', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryUrl.mockImplementation(
      async (_url: string, { body }: { body: { method: string; params: unknown[] } }) => ({
        jsonrpc: '2.0',
        id: 1,
        result:
          body.method === 'chain_getBlockHash'
            ? body.params[0] === 0
              ? GENESIS_HASH
              : BLOCK_HASH
            : rpcResults[body.method],
      })
    )
    mocks.refineBittensorChainSpecific.mockImplementation(async ({ chainSpecific }) => chainSpecific)
  })

  it('reads the runtime, head, nonce and genesis from the node', async () => {
    const result = await getBittensorChainSpecific({ keysignPayload, walletCore: {} as never })

    expect(result.nonce).toBe(7n)
    expect(result.currentBlockNumber).toBe('4000000')
    expect(result.specVersion).toBe(458)
    expect(result.genesisHash).toBe(GENESIS_HASH)
    expect(result.recentBlockHash).toBe(BLOCK_HASH)
    expect(result.gas).toBe(bittensorConfig.fee)
  })

  // The signing resolvers on every device read the call index from this
  // field, so it is recorded from the caller's explicit choice and never
  // inferred — and it is handed to the fee refinement, which prices the call.
  it('records allowDeath only when the caller asks for it, and prices that call', async () => {
    const keepAlive = await getBittensorChainSpecific({ keysignPayload, walletCore: {} as never })
    expect(keepAlive.allowDeath).toBe(false)

    const allowDeath = await getBittensorChainSpecific({ keysignPayload, walletCore: {} as never, allowDeath: true })
    expect(allowDeath.allowDeath).toBe(true)
    expect(mocks.refineBittensorChainSpecific).toHaveBeenLastCalledWith(
      expect.objectContaining({ chainSpecific: expect.objectContaining({ allowDeath: true }) })
    )
  })
})
