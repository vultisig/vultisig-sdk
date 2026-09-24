import { create } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { bittensorConfig } from '@vultisig/core-chain/chains/bittensor/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'
import { BuildKeysignPayloadError } from '../error'

const mocks = vi.hoisted(() => ({
  getBittensorCoinBalance: vi.fn(),
}))

vi.mock('@vultisig/core-chain/coin/balance/resolvers/bittensor', () => ({
  getBittensorCoinBalance: mocks.getBittensorCoinBalance,
}))

import { assertBittensorDestinationStaysAlive } from './assertBittensorDestinationStaysAlive'

const SENDER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const DEST_FUNDED = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const DEST_EMPTY = '5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy'

const taoCoin = { chain: Chain.Bittensor, ticker: 'TAO', address: SENDER, decimals: 9 }

const assertStaysAlive = ({
  coin = taoCoin,
  toAddress,
  toAmount,
}: {
  coin?: typeof taoCoin
  toAddress: string
  toAmount: string
}) =>
  assertBittensorDestinationStaysAlive({
    coin,
    keysignPayload: create(KeysignPayloadSchema, { toAddress, toAmount }),
  })

describe('assertBittensorDestinationStaysAlive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBittensorCoinBalance.mockImplementation(async ({ address }: { address: string }) =>
      address === DEST_EMPTY ? 0n : 1_000_000_000n
    )
  })

  it('ignores every other chain', async () => {
    await expect(
      assertStaysAlive({ coin: { ...taoCoin, chain: Chain.Polkadot }, toAddress: DEST_EMPTY, toAmount: '1' })
    ).resolves.toBeUndefined()
    expect(mocks.getBittensorCoinBalance).not.toHaveBeenCalled()
  })

  it('lets an ordinary send through without reading the destination', async () => {
    await expect(assertStaysAlive({ toAddress: DEST_EMPTY, toAmount: '1000000000' })).resolves.toBeUndefined()
    expect(mocks.getBittensorCoinBalance).not.toHaveBeenCalled()
  })

  // Bittensor refuses to create an account below 500 rao, so a dust send to an
  // empty destination is doomed on-chain — reject it before the ceremony.
  it('rejects a sub-deposit amount to an empty destination', async () => {
    const promise = assertStaysAlive({ toAddress: DEST_EMPTY, toAmount: '499' })

    await expect(promise).rejects.toBeInstanceOf(BuildKeysignPayloadError)
    await expect(promise).rejects.toMatchObject({ type: 'bittensor-destination-below-existential-deposit' })
  })

  it('accepts exactly the existential deposit to an empty destination', async () => {
    await expect(
      assertStaysAlive({ toAddress: DEST_EMPTY, toAmount: String(bittensorConfig.existentialDeposit) })
    ).resolves.toBeUndefined()
  })

  it('accepts a sub-deposit amount to a destination that already holds the deposit', async () => {
    await expect(assertStaysAlive({ toAddress: DEST_FUNDED, toAmount: '1' })).resolves.toBeUndefined()
    expect(mocks.getBittensorCoinBalance).toHaveBeenCalledWith({ chain: Chain.Bittensor, address: DEST_FUNDED })
  })
})
