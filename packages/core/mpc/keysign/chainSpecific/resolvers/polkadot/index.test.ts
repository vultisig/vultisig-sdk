import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { polkadotConfig } from '@vultisig/core-chain/chains/polkadot/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CoinSchema } from '../../../../types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '../../../../types/vultisig/keysign/v1/keysign_message_pb'

const mocks = vi.hoisted(() => ({
  getPolkadotClient: vi.fn(),
  refinePolkadotChainSpecific: vi.fn(),
}))

vi.mock('@vultisig/core-chain/chains/polkadot/client', () => ({
  getPolkadotClient: mocks.getPolkadotClient,
}))

vi.mock('./refine', () => ({
  refinePolkadotChainSpecific: mocks.refinePolkadotChainSpecific,
}))

import { getPolkadotChainSpecific } from './index'

const SENDER = '14E5nqKAp3oAJcmzgs25fyAmgeNL66XceFLiTqAZkdVH5T38'
const DESTINATION = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const GENESIS_HASH = '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f'

const keysignPayload = create(KeysignPayloadSchema, {
  coin: create(CoinSchema, {
    chain: Chain.Polkadot,
    ticker: 'DOT',
    address: SENDER,
    decimals: 10,
    isNativeToken: true,
  }),
  toAddress: DESTINATION,
  toAmount: '10000000000',
})

const resolve = (allowDeath?: boolean) =>
  getPolkadotChainSpecific({
    keysignPayload,
    walletCore: {} as never,
    ...(allowDeath === undefined ? {} : { allowDeath }),
  })

describe('getPolkadotChainSpecific', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPolkadotClient.mockResolvedValue({
      rpc: {
        state: {
          getRuntimeVersion: async () => ({
            specVersion: { toNumber: () => 1003004 },
            transactionVersion: { toNumber: () => 26 },
          }),
        },
        chain: {
          getHeader: async () => ({ hash: { toHex: () => BLOCK_HASH }, number: { toString: () => '20000000' } }),
          getBlockHash: async () => ({ toHex: () => GENESIS_HASH }),
        },
        system: { accountNextIndex: async () => ({ toBigInt: () => 3n }) },
      },
    })
    mocks.refinePolkadotChainSpecific.mockImplementation(async ({ chainSpecific }) => chainSpecific)
  })

  it('reads the runtime, head, nonce and genesis from the node', async () => {
    const result = await resolve()

    expect(result.nonce).toBe(3n)
    expect(result.currentBlockNumber).toBe('20000000')
    expect(result.specVersion).toBe(1003004)
    expect(result.transactionVersion).toBe(26)
    expect(result.recentBlockHash).toBe(BLOCK_HASH)
    expect(result.genesisHash).toBe(GENESIS_HASH)
    expect(result.gas).toBe(polkadotConfig.fee)
  })

  // The signing resolvers on every device read the call index from this
  // field, so it is recorded from the caller's explicit choice and never
  // inferred — and it is handed to the fee refinement, which prices the call.
  it('records allowDeath only when the caller asks for it, and prices that call', async () => {
    expect((await resolve()).allowDeath).toBe(false)

    expect((await resolve(true)).allowDeath).toBe(true)
    expect(mocks.refinePolkadotChainSpecific).toHaveBeenLastCalledWith(
      expect.objectContaining({ chainSpecific: expect.objectContaining({ allowDeath: true }) })
    )
  })
})
