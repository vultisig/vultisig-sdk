import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { PolkadotSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { getPolkadotSigningInputs } from './polkadot'

// Polkadot Asset Hub genesis hash (statemint)
const GENESIS_HASH = '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f'
// Arbitrary valid SS58-0 Polkadot address
const TO_ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Srd'
const FROM_ADDRESS = '14E5nqKAp3oAJcmzgs25fyAmgeNL66XceFLiTqAZkdVH5T38'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'

const buildPayload = () =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Polkadot,
      ticker: 'DOT',
      address: FROM_ADDRESS,
      decimals: 10,
      isNativeToken: true,
    }),
    toAddress: TO_ADDRESS,
    toAmount: '10000000000',
    blockchainSpecific: {
      case: 'polkadotSpecific',
      value: create(PolkadotSpecificSchema, {
        recentBlockHash: BLOCK_HASH,
        nonce: 0n,
        currentBlockNumber: '20000000',
        specVersion: 1003004,
        transactionVersion: 26,
        genesisHash: GENESIS_HASH,
      }),
    },
  })

describe('getPolkadotSigningInputs', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('uses methodIndex 3 (transfer_keep_alive) not 0 (transfer_allow_death)', () => {
    const [input] = getPolkadotSigningInputs({ keysignPayload: buildPayload(), walletCore })

    const callIndices = input.balanceCall?.assetTransfer?.callIndices?.custom
    expect(callIndices).toBeDefined()
    expect(callIndices?.methodIndex).toBe(3)
  })

  it('keeps moduleIndex 10 (pallet_balances on Asset Hub)', () => {
    const [input] = getPolkadotSigningInputs({ keysignPayload: buildPayload(), walletCore })

    const callIndices = input.balanceCall?.assetTransfer?.callIndices?.custom
    expect(callIndices?.moduleIndex).toBe(10)
  })
})
