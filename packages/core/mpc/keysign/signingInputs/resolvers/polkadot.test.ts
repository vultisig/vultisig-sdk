import { Buffer } from 'buffer'

import { create } from '@bufbuild/protobuf'
import { initWasm, TW, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { getCoinType } from '@vultisig/core-chain/coin/coinType'
import { PolkadotSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import { compileTx } from '../../../tx/compile/compileTx'
import { getPreSigningHashes } from '../../../tx/preSigningHashes'
import { getEncodedSigningInputs } from '../index'
import { getPolkadotSigningInputs } from './polkadot'

// Polkadot Asset Hub genesis hash (statemint)
const GENESIS_HASH = '0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f'
// Arbitrary valid SS58-0 Polkadot address
const TO_ADDRESS = '15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Srd'
const FROM_ADDRESS = '14E5nqKAp3oAJcmzgs25fyAmgeNL66XceFLiTqAZkdVH5T38'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'
const EDDSA_PRIVATE_KEY = new Uint8Array(32).fill(1)
const CALL_INDICES_OFFSET = 107

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const buildPayload = ({ address = FROM_ADDRESS, hexPublicKey }: { address?: string; hexPublicKey?: string } = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Polkadot,
      ticker: 'DOT',
      address,
      decimals: 10,
      isNativeToken: true,
      ...(hexPublicKey ? { hexPublicKey } : {}),
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

  it('uses methodIndex 3 (transfer_keep_alive) not 0 (transfer_allow_death)', async () => {
    const [input] = await getPolkadotSigningInputs({ keysignPayload: buildPayload(), walletCore })

    const callIndices = input.balanceCall?.assetTransfer?.callIndices?.custom
    expect(callIndices).toBeDefined()
    expect(callIndices?.methodIndex).toBe(3)
  })

  it('keeps moduleIndex 10 (pallet_balances on Asset Hub)', async () => {
    const [input] = await getPolkadotSigningInputs({ keysignPayload: buildPayload(), walletCore })

    const callIndices = input.balanceCall?.assetTransfer?.callIndices?.custom
    expect(callIndices?.moduleIndex).toBe(10)
  })

  it('pins the compiled SCALE call indices for transfer_keep_alive', async () => {
    const privateKey = walletCore.PrivateKey.createWithData(EDDSA_PRIVATE_KEY)
    const publicKey = privateKey.getPublicKeyEd25519()
    const address = walletCore.AnyAddress.createWithPublicKey(
      publicKey,
      getCoinType({ walletCore, chain: Chain.Polkadot })
    ).description()
    const keysignPayload = buildPayload({
      address,
      hexPublicKey: hex(publicKey.data()),
    })
    const [txInputData] = await getEncodedSigningInputs({
      keysignPayload,
      walletCore,
      publicKey,
    })
    const [hash] = getPreSigningHashes({
      walletCore,
      chain: Chain.Polkadot,
      txInputData,
    })
    const rawSignature = privateKey.sign(hash, walletCore.Curve.ed25519)
    const compiled = compileTx({
      publicKey,
      txInputData,
      signatures: {
        [hex(hash)]: {
          msg: '',
          r: hex(rawSignature.slice(0, 32).reverse()),
          s: hex(rawSignature.slice(32, 64).reverse()),
          der_signature: '',
        },
      },
      chain: Chain.Polkadot,
      walletCore,
    })

    const compiledOutput = TW.Polkadot.Proto.SigningOutput.decode(compiled)
    const encodedHex = hex(compiledOutput.encoded)

    expect(encodedHex.slice(CALL_INDICES_OFFSET * 2, (CALL_INDICES_OFFSET + 2) * 2)).toBe('0a03')
    const callIndexOffsets = [...encodedHex.matchAll(/0a03/g)]
      .map(({ index }) => index)
      .filter((index): index is number => index !== undefined)
      .map(index => index / 2)
    expect(callIndexOffsets).toEqual([CALL_INDICES_OFFSET])
  })
})
