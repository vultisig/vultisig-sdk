/**
 * Initiator-side attach of per-UTXO Cardano native-token data.
 *
 * The Cardano branch must ship token-aware UTXOs (Koios `_extended`) on the
 * keysign payload, byte-deterministically: UTXOs ordered by (hash, index) and
 * assets ordered by (policyId, assetNameHex) with lowercased hex — mirroring
 * the iOS initiator (`KeysignPayloadFactory.selectCardanoUTXOs`), so both MPC
 * peers see identical proto bytes regardless of Koios response ordering.
 */
import { fromBinary, toBinary } from '@bufbuild/protobuf'
import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryUrl: vi.fn(),
}))

vi.mock('@vultisig/lib-utils/query/queryUrl', () => ({
  queryUrl: mocks.queryUrl,
}))

// Keeps the transitive bare @vultisig/core-config import (unbuilt dist) out
// of the unit-test module graph; the real getCardanoExtendedUtxos logic —
// mapping and (hash, index) ordering — stays live.
vi.mock('@vultisig/core-config', () => ({
  rootApiUrl: 'https://api.vultisig.test',
}))

import { UtxoInfoSchema } from '../../types/vultisig/keysign/v1/utxo_info_pb'
import { getKeysignUtxoInfo } from './getKeysignUtxoInfo'

const address =
  'addr1qx2kd28nq8ac5prwg32hhvudlwggpgfp8utlyqxu6wqgz62f79qsdmm5dsknt9ecr5w468r9ey0fxwkdrwh08ly3tu9sy0f4qd'

const sundaePolicy = '9a9693a9a37912a5097918f97918d15240c92ab729a0b7c4aa144d77'
const usdmPolicy = 'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad'

const koiosExtendedResponse = [
  // Deliberately out of (hash, index) order, with assets out of canonical
  // order and uppercased hex — the attach path must normalize all of it.
  {
    tx_hash: 'ff'.repeat(32),
    tx_index: 1,
    value: '2500000',
    asset_list: [
      {
        policy_id: usdmPolicy.toUpperCase(),
        asset_name: '0014DF105553444D',
        decimals: 6,
        quantity: '665000',
        fingerprint: 'asset1c6uau7pufsxhnm7eg0eerhu4snwfd9sn7kvvvz',
      },
      {
        policy_id: sundaePolicy,
        asset_name: '53554e444145',
        decimals: 6,
        quantity: '18446744073709551616',
        fingerprint: 'asset1v25eyenfzrv6me9hw4vczfprdctzy5ed3x99p0',
      },
    ],
  },
  {
    tx_hash: '11'.repeat(32),
    tx_index: 2,
    value: '1500000',
    asset_list: null,
  },
  {
    tx_hash: '11'.repeat(32),
    tx_index: 0,
    value: '3000000',
    asset_list: [],
  },
  {
    tx_hash: '33'.repeat(32),
    tx_index: 0,
    value: '2000000',
    asset_list: [
      // Unnamed asset (null asset_name) with a noncanonical quantity — must
      // normalize to the empty hex name and the canonical decimal string,
      // like iOS (nil → "", BigInt round-trip).
      {
        policy_id: sundaePolicy.toUpperCase(),
        asset_name: null,
        decimals: 0,
        quantity: '0042',
        fingerprint: 'asset1unnamed0000000000000000000000000000000',
      },
    ],
  },
]

describe('getKeysignUtxoInfo — Cardano', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryUrl.mockResolvedValue(koiosExtendedResponse)
  })

  it('fetches extended UTXOs so token data is present', async () => {
    await getKeysignUtxoInfo({ chain: Chain.Cardano, address })

    expect(mocks.queryUrl).toHaveBeenCalledTimes(1)
    const [url, { body }] = mocks.queryUrl.mock.calls[0]
    expect(url).toMatch(/address_utxos$/)
    expect(body).toEqual({ _addresses: [address], _extended: true })
  })

  it('orders UTXOs by (hash, index) and assets by (policyId, assetNameHex), lowercased', async () => {
    const utxoInfo = await getKeysignUtxoInfo({
      chain: Chain.Cardano,
      address,
    })

    expect(utxoInfo).toBeDefined()
    expect(utxoInfo!.map(({ hash, index }) => [hash, index])).toEqual([
      ['11'.repeat(32), 0],
      ['11'.repeat(32), 2],
      ['33'.repeat(32), 0],
      ['ff'.repeat(32), 1],
    ])

    const [first, second, unnamed, third] = utxoInfo!
    expect(first.amount).toBe(3000000n)
    expect(first.cardanoTokens).toEqual([])
    expect(second.cardanoTokens).toEqual([])

    // Canonical (policyId, assetNameHex) order: SUNDAE's policy sorts before
    // USDM's, and Koios's uppercase hex is normalized to lowercase.
    expect(third.amount).toBe(2500000n)
    expect(
      third.cardanoTokens.map(({ policyId, assetNameHex, amount }) => ({
        policyId,
        assetNameHex,
        amount,
      }))
    ).toEqual([
      {
        policyId: sundaePolicy,
        assetNameHex: '53554e444145',
        amount: '18446744073709551616',
      },
      {
        policyId: usdmPolicy,
        assetNameHex: '0014df105553444d',
        amount: '665000',
      },
    ])

    // Unnamed asset: null asset_name → empty hex name (iOS nil → "");
    // noncanonical quantity "0042" → canonical decimal "42" (iOS BigInt
    // round-trip), so both platforms serialize identical proto bytes.
    expect(
      unnamed.cardanoTokens.map(({ policyId, assetNameHex, amount }) => ({
        policyId,
        assetNameHex,
        amount,
      }))
    ).toEqual([{ policyId: sundaePolicy, assetNameHex: '', amount: '42' }])
  })

  it('round-trips token data through the UtxoInfo wire format', async () => {
    const utxoInfo = await getKeysignUtxoInfo({
      chain: Chain.Cardano,
      address,
    })
    const tokenUtxo = utxoInfo![3]

    const decoded = fromBinary(UtxoInfoSchema, toBinary(UtxoInfoSchema, tokenUtxo))

    expect(decoded.hash).toBe(tokenUtxo.hash)
    expect(decoded.amount).toBe(tokenUtxo.amount)
    expect(decoded.index).toBe(tokenUtxo.index)
    expect(
      decoded.cardanoTokens.map(({ policyId, assetNameHex, amount }) => ({
        policyId,
        assetNameHex,
        amount,
      }))
    ).toEqual([
      {
        policyId: sundaePolicy,
        assetNameHex: '53554e444145',
        amount: '18446744073709551616',
      },
      {
        policyId: usdmPolicy,
        assetNameHex: '0014df105553444d',
        amount: '665000',
      },
    ])
  })

  it('fails the send on a malformed or negative asset quantity instead of attaching it', async () => {
    mocks.queryUrl.mockResolvedValue([
      {
        tx_hash: 'aa'.repeat(32),
        tx_index: 0,
        value: '2000000',
        asset_list: [
          {
            policy_id: sundaePolicy,
            asset_name: '53554e444145',
            decimals: 6,
            quantity: '-1',
            fingerprint: 'asset1v25eyenfzrv6me9hw4vczfprdctzy5ed3x99p0',
          },
        ],
      },
    ])

    await expect(getKeysignUtxoInfo({ chain: Chain.Cardano, address })).rejects.toThrow(/Negative Cardano asset/)
  })
})
