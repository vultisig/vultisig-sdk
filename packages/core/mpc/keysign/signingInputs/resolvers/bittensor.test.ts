import { Buffer } from 'buffer'

import { compactToU8a } from '@polkadot/util'
import { decodeAddress } from '@polkadot/util-crypto'
import { GenericExtrinsicEra, TypeRegistry } from '@polkadot/types'
import { create } from '@bufbuild/protobuf'
import { initWasm, type WalletCore } from '@trustwallet/wallet-core'
import { Chain } from '@vultisig/core-chain/Chain'
import { PolkadotSpecificSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/blockchain_specific_pb'
import { CoinSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/coin_pb'
import { KeysignPayloadSchema } from '@vultisig/core-mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  buildBittensorSigningPayload,
  assembleBittensorExtrinsic,
} from '@vultisig/core-chain/chains/bittensor/signing/buildExtrinsic'
import { compactEncode, encodeMortalEra } from '@vultisig/core-chain/chains/bittensor/signing/scale'
import { decodeBittensorTxInput, getBittensorSigningInputs } from './bittensor'

// Bittensor (finney) genesis hash
const GENESIS_HASH = '0x2f0555cc76fc2840a25a6ea3b9637146806f1f44b090c175ffde2a7e5ab36c03'
// Arbitrary valid SS58-42 (Bittensor/generic Substrate) address
const TO_ADDRESS = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'
const FROM_ADDRESS = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
const BLOCK_HASH = '0xaabbccddeeff00112233445566778899aabbccddeeff00112233445566778899'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

const buildPayload = ({ address = FROM_ADDRESS, hexPublicKey }: { address?: string; hexPublicKey?: string } = {}) =>
  create(KeysignPayloadSchema, {
    coin: create(CoinSchema, {
      chain: Chain.Bittensor,
      ticker: 'TAO',
      address,
      decimals: 9,
      isNativeToken: true,
      ...(hexPublicKey ? { hexPublicKey } : {}),
    }),
    toAddress: TO_ADDRESS,
    toAmount: '1000000000',
    blockchainSpecific: {
      case: 'polkadotSpecific',
      value: create(PolkadotSpecificSchema, {
        recentBlockHash: BLOCK_HASH,
        nonce: 5n,
        currentBlockNumber: '4000000',
        specVersion: 225,
        transactionVersion: 1,
        genesisHash: GENESIS_HASH,
      }),
    },
  })

// buildExtrinsic.ts's scale.ts is a HAND-ROLLED SCALE codec (bypasses @polkadot/api's
// metadata-driven encoder entirely, per the file's own top comment — TW Core doesn't
// support Bittensor's CheckMetadataHash signed extension, so this custom path exists).
// Unlike Polkadot's sibling resolver (compiled + decoded through WalletCore, verified
// byte-for-byte in polkadot.test.ts), there was NO independent verification of this
// hand-rolled encoder at all before this PR — a wrong compact-encoded amount or nonce
// here is a direct fund-loss/wrong-tx risk with zero test coverage catching it.
describe('compactEncode — cross-checked against @polkadot/util (the real SCALE reference)', () => {
  it.each([
    0n,
    1n,
    63n,
    64n, // single-byte / 2-byte mode boundary
    100n,
    16383n,
    16384n, // 2-byte / 4-byte mode boundary
    1000000n,
    1073741823n,
    1073741824n, // 4-byte / big-integer mode boundary
    100000000000n,
    123456789012345n, // realistic TAO amounts (base units, 9 decimals)
  ])('matches @polkadot/util.compactToU8a for %s', value => {
    expect(hex(compactEncode(value))).toBe(hex(compactToU8a(value)))
  })
})

describe('encodeMortalEra — cross-checked against @polkadot/types (the real SCALE reference)', () => {
  const registry = new TypeRegistry()
  it.each([
    { blockNumber: 4000000, period: 64 },
    { blockNumber: 12345678, period: 64 },
    { blockNumber: 0, period: 64 },
    { blockNumber: 4000000, period: 128 },
  ])('matches GenericExtrinsicEra for block=$blockNumber period=$period', ({ blockNumber, period }) => {
    const real = new GenericExtrinsicEra(registry, { current: blockNumber, period })
    expect(hex(encodeMortalEra(blockNumber, period))).toBe(hex(real.toU8a()))
  })
})

// Live-verified against the REAL Bittensor (finney) mainnet runtime metadata
// (state_getMetadata via entrypoint-finney.opentensor.ai, 2026-07-08) — NOT assumed
// from the source comment. Confirms buildExtrinsic.ts's hardcoded balancesPallet=5 /
// transferAllowDeath=0 constants match the chain's actual pallet/call indices; a
// runtime upgrade that renumbers either would silently mis-route the extrinsic
// (e.g. onto a different pallet's call) with no error until broadcast rejects it.
describe('Bittensor Balances.transfer_allow_death call indices (live-verified against mainnet metadata)', () => {
  it('encodes moduleIndex 5 (pallet_balances) + methodIndex 0 (transfer_allow_death)', () => {
    const { callData } = buildBittensorSigningPayload({
      toAddress: TO_ADDRESS,
      amount: 1000000000n,
      nonce: 5,
      blockNumber: 4000000,
      blockHash: BLOCK_HASH,
      genesisHash: GENESIS_HASH,
      specVersion: 225,
      transactionVersion: 1,
    })
    expect(callData[0]).toBe(5) // Balances pallet index
    expect(callData[1]).toBe(0) // transfer_allow_death call index
  })
})

describe('buildBittensorSigningPayload — golden vector (full byte-for-byte pin)', () => {
  const params = {
    toAddress: TO_ADDRESS,
    amount: 1000000000n, // 1 TAO
    nonce: 5,
    blockNumber: 4000000,
    blockHash: BLOCK_HASH,
    genesisHash: GENESIS_HASH,
    specVersion: 225,
    transactionVersion: 1,
  }

  it('produces the expected callData bytes (pallet + method + MultiAddress::Id + dest pubkey + compact amount)', () => {
    const { callData } = buildBittensorSigningPayload(params)
    const destPubkey = decodeAddress(TO_ADDRESS)
    const expected = Buffer.concat([
      Buffer.from([5, 0]), // Balances.transfer_allow_death
      Buffer.from([0x00]), // MultiAddress::Id tag
      Buffer.from(destPubkey),
      Buffer.from(compactToU8a(params.amount)),
    ])
    expect(hex(callData)).toBe(hex(expected))
  })

  it('produces the expected signedExtra bytes (mortal era + compact nonce + compact tip=0 + metadataHash mode=0)', () => {
    const { signedExtra } = buildBittensorSigningPayload(params)
    const era = new GenericExtrinsicEra(new TypeRegistry(), { current: params.blockNumber, period: 64 })
    const expected = Buffer.concat([
      Buffer.from(era.toU8a()),
      Buffer.from(compactToU8a(params.nonce)),
      Buffer.from(compactToU8a(0)),
      Buffer.from([0x00]), // CheckMetadataHash::Disabled
    ])
    expect(hex(signedExtra)).toBe(hex(expected))
  })

  it('produces the expected full signing payload (callData ++ signedExtra ++ additionalSigned)', () => {
    const { callData, signedExtra, payload } = buildBittensorSigningPayload(params)
    // additionalSigned = specVersion(u32 LE) ++ txVersion(u32 LE) ++ genesisHash(32B) ++ blockHash(32B) ++ metadataHash(None=0x00)
    const specVersionBytes = Buffer.alloc(4)
    specVersionBytes.writeUInt32LE(params.specVersion, 0)
    const txVersionBytes = Buffer.alloc(4)
    txVersionBytes.writeUInt32LE(params.transactionVersion, 0)
    const additionalSigned = Buffer.concat([
      specVersionBytes,
      txVersionBytes,
      Buffer.from(params.genesisHash.slice(2), 'hex'),
      Buffer.from(params.blockHash.slice(2), 'hex'),
      Buffer.from([0x00]),
    ])
    const expected = Buffer.concat([Buffer.from(callData), Buffer.from(signedExtra), additionalSigned])
    expect(hex(payload)).toBe(hex(expected))
  })
})

describe('assembleBittensorExtrinsic — golden vector (final signed extrinsic structure)', () => {
  it('assembles signed-v4 prefix + MultiAddress::Id(signer) + MultiSignature::Ed25519(sig) + signedExtra + callData, length-prefixed', () => {
    const { callData, signedExtra } = buildBittensorSigningPayload({
      toAddress: TO_ADDRESS,
      amount: 1000000000n,
      nonce: 5,
      blockNumber: 4000000,
      blockHash: BLOCK_HASH,
      genesisHash: GENESIS_HASH,
      specVersion: 225,
      transactionVersion: 1,
    })
    const signerPubkey = decodeAddress(FROM_ADDRESS)
    const signature = new Uint8Array(64).fill(0xab)

    const extrinsic = assembleBittensorExtrinsic(signerPubkey, signature, callData, signedExtra)

    const body = Buffer.concat([
      Buffer.from([0x84]), // signed extrinsic, version 4
      Buffer.from([0x00]), // MultiAddress::Id tag
      Buffer.from(signerPubkey),
      Buffer.from([0x00]), // MultiSignature::Ed25519 tag
      Buffer.from(signature),
      Buffer.from(signedExtra),
      Buffer.from(callData),
    ])
    const expected = Buffer.concat([Buffer.from(compactToU8a(body.length)), body])
    expect(hex(extrinsic)).toBe(hex(expected))
  })
})

// getBittensorSigningInputs's custom [len][callData][len][signedExtra][payload] binary
// framing (encodeBittensorTxInput / decodeBittensorTxInput) had zero test coverage —
// a length-prefix miscalculation here would corrupt compileTx's ability to reassemble
// the final extrinsic (wrong callData/signedExtra slice boundaries), silently signing
// or broadcasting the wrong bytes.
describe('getBittensorSigningInputs — custom tx-input framing round-trips', () => {
  let walletCore: WalletCore

  beforeAll(async () => {
    walletCore = await initWasm()
  })

  it('round-trips callData/signedExtra/payload through encode -> decode unchanged', async () => {
    const [txInputData] = getBittensorSigningInputs({ keysignPayload: buildPayload(), walletCore })
    const { callData, signedExtra, payload } = buildBittensorSigningPayload({
      toAddress: TO_ADDRESS,
      amount: 1000000000n,
      nonce: 5,
      blockNumber: 4000000,
      blockHash: BLOCK_HASH,
      genesisHash: GENESIS_HASH,
      specVersion: 225,
      transactionVersion: 1,
    })

    const decoded = decodeBittensorTxInput(txInputData)
    expect(hex(decoded.callData)).toBe(hex(callData))
    expect(hex(decoded.signedExtra)).toBe(hex(signedExtra))
    expect(hex(decoded.payload)).toBe(hex(payload))
  })
})
