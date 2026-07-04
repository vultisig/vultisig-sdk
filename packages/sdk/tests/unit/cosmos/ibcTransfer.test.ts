/**
 * Unit tests for the pure-crypto ICS-20 IBC transfer builder
 * (`sdk.prep.ibcTransfer` → `prepareIbcTransfer`).
 *
 * Deterministic + offline: the builder never touches the network and never
 * signs. Test addresses are generated via @scure/base bech32 so checksums are
 * valid round-trips (no hand-typed addresses with bogus checksums).
 */
import { bech32 } from '@scure/base'
import { describe, expect, it } from 'vitest'

import {
  IBC_MSG_TRANSFER_TYPE_URL,
  normaliseIbcChainId,
  prepareIbcTransfer,
  supportedIbcDestinationsFrom,
} from '@/tools/prep/ibcTransfer'

/** Build a valid bech32 address for `hrp` from a fixed 20-byte payload. */
function addr(hrp: string, fill = 7): string {
  const bytes = new Uint8Array(20).fill(fill)
  return bech32.encode(hrp as `${string}`, bech32.toWords(bytes), false)
}

const OSMO = addr('osmo')
const COSMOS = addr('cosmos')
const TERRA = addr('terra')
// 2026-07-01T00:00:00Z, comfortably in the future for timeout checks.
const FIXED_NOW = 1782604800000

describe('prepareIbcTransfer', () => {
  it('builds an OSMO→cosmoshub-4 MsgTransfer with channel reverse-resolved from toChainId', () => {
    const r = prepareIbcTransfer({
      fromChain: 'osmosis-1',
      toChainId: 'cosmoshub-4',
      fromAddress: OSMO,
      toAddress: COSMOS,
      denom: 'uosmo',
      amount: '1000000',
      nowMs: FIXED_NOW,
    })

    expect(r.fromChain).toBe('osmosis-1')
    expect(r.destChain).toBe('cosmoshub-4')
    expect(r.sourceChannel).toBe('channel-0')
    expect(r.routeDescription).toBe('osmosis-1 → cosmoshub-4 via channel-0')
    expect(r.msgTypeUrl).toBe(IBC_MSG_TRANSFER_TYPE_URL)

    expect(r.msgTransfer).toMatchObject({
      source_port: 'transfer',
      source_channel: 'channel-0',
      token: { denom: 'uosmo', amount: '1000000' },
      sender: OSMO,
      receiver: COSMOS,
      timeout_height: { revision_number: '0', revision_height: '0' },
      memo: '',
    })

    // envelope is the exact shape the signing client consumes
    expect(r.cosmosTx.chain_id).toBe('osmosis-1')
    expect(r.cosmosTx.signer_address).toBe(OSMO)
    expect(r.cosmosTx.msgs).toHaveLength(1)
    expect(r.cosmosTx.msgs[0]!.msg_type_url).toBe(IBC_MSG_TRANSFER_TYPE_URL)
    // inner msg is JSON-encoded and round-trips to the decoded form
    expect(JSON.parse(r.cosmosTx.msgs[0]!.msg)).toEqual(r.msgTransfer)
  })

  it('accepts Vultisig canonical names ("Osmosis"/"Cosmos") and normalises to chain-IDs', () => {
    const r = prepareIbcTransfer({
      fromChain: 'Osmosis',
      toChainId: 'Cosmos',
      fromAddress: OSMO,
      toAddress: COSMOS,
      denom: 'uosmo',
      amount: '5',
      nowMs: FIXED_NOW,
    })
    expect(r.fromChain).toBe('osmosis-1')
    expect(r.destChain).toBe('cosmoshub-4')
    expect(r.sourceChannel).toBe('channel-0')
  })

  it('normaliseIbcChainId maps every Vultisig canonical name to its IBC chain-ID (mcp-ts parity)', () => {
    // Mirror of mcp-ts build_ibc_transfer VULTISIG_NAME_TO_CHAIN_ID. THORChain /
    // MayaChain have no IBC_CHANNEL_DEST route, but the alias must still resolve
    // so callers get a "no route" error against the canonical chain-ID rather
    // than a misleading "unknown chain THORChain".
    expect(normaliseIbcChainId('Cosmos')).toBe('cosmoshub-4')
    expect(normaliseIbcChainId('Osmosis')).toBe('osmosis-1')
    expect(normaliseIbcChainId('Terra')).toBe('phoenix-1')
    expect(normaliseIbcChainId('TerraClassic')).toBe('columbus-5')
    expect(normaliseIbcChainId('Kujira')).toBe('kaiyo-1')
    expect(normaliseIbcChainId('Akash')).toBe('akashnet-2')
    expect(normaliseIbcChainId('Noble')).toBe('noble-1')
    expect(normaliseIbcChainId('Dydx')).toBe('dydx-mainnet-1')
    expect(normaliseIbcChainId('MayaChain')).toBe('mayachain-mainnet-v1')
    expect(normaliseIbcChainId('THORChain')).toBe('thorchain-1')
    expect(normaliseIbcChainId('Stride')).toBe('stride-1')
    // unknown / already-an-ID inputs pass through untouched
    expect(normaliseIbcChainId('cosmoshub-4')).toBe('cosmoshub-4')
    expect(normaliseIbcChainId('not-a-chain')).toBe('not-a-chain')
  })

  it('resolves destination from sourceChannel alone', () => {
    const r = prepareIbcTransfer({
      fromChain: 'phoenix-1',
      sourceChannel: 'channel-1',
      fromAddress: TERRA,
      toAddress: OSMO,
      denom: 'uluna',
      amount: '1000000',
      nowMs: FIXED_NOW,
    })
    expect(r.destChain).toBe('osmosis-1')
    expect(r.sourceChannel).toBe('channel-1')
  })

  it('cross-validates sourceChannel + toChainId and throws on a mismatched pair', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        sourceChannel: 'channel-0', // routes to cosmoshub-4
        toChainId: 'juno-1',
        fromAddress: OSMO,
        toAddress: addr('juno'),
        denom: 'uosmo',
        amount: '1',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/routes to cosmoshub-4, NOT juno-1/)
  })

  it('threads caller-supplied accountNumber + sequence into the envelope', () => {
    const r = prepareIbcTransfer({
      fromChain: 'osmosis-1',
      toChainId: 'cosmoshub-4',
      fromAddress: OSMO,
      toAddress: COSMOS,
      denom: 'uosmo',
      amount: '1',
      accountNumber: '12345',
      sequence: '7',
      memo: 'gm',
      nowMs: FIXED_NOW,
    })
    expect(r.cosmosTx.account_number).toBe('12345')
    expect(r.cosmosTx.sequence).toBe('7')
    expect(r.msgTransfer.memo).toBe('gm')
  })

  it('omits account_number/sequence when not supplied', () => {
    const r = prepareIbcTransfer({
      fromChain: 'osmosis-1',
      toChainId: 'cosmoshub-4',
      fromAddress: OSMO,
      toAddress: COSMOS,
      denom: 'uosmo',
      amount: '1',
      nowMs: FIXED_NOW,
    })
    expect(r.cosmosTx.account_number).toBeUndefined()
    expect(r.cosmosTx.sequence).toBeUndefined()
  })

  it('defaults timeout_timestamp to now + 10 minutes in nanoseconds', () => {
    const r = prepareIbcTransfer({
      fromChain: 'osmosis-1',
      toChainId: 'cosmoshub-4',
      fromAddress: OSMO,
      toAddress: COSMOS,
      denom: 'uosmo',
      amount: '1',
      nowMs: FIXED_NOW,
    })
    const expected = (BigInt(FIXED_NOW + 10 * 60 * 1000) * 1_000_000n).toString()
    expect(r.msgTransfer.timeout_timestamp).toBe(expected)
  })

  // ── fund-safety / validation ──────────────────────────────────────────────

  it('rejects a wrong-HRP receiver (cosmos1... when osmo expected)', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        sourceChannel: 'channel-341', // → phoenix-1 (expects terra)
        fromAddress: OSMO,
        toAddress: COSMOS, // cosmos, not terra
        denom: 'uosmo',
        amount: '1',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/does not match expected "terra"/)
  })

  it('rejects a validator OPERATOR address as receiver (unrecoverable funds)', () => {
    const valoper = addr('cosmosvaloper')
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        toChainId: 'cosmoshub-4',
        fromAddress: OSMO,
        toAddress: valoper,
        denom: 'uosmo',
        amount: '1',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/validator OPERATOR address/)
  })

  it('rejects a non-positive amount', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        toChainId: 'cosmoshub-4',
        fromAddress: OSMO,
        toAddress: COSMOS,
        denom: 'uosmo',
        amount: '0',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/must be positive/)
  })

  it('rejects an unroutable destination and lists supported destinations', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'cosmoshub-4',
        toChainId: 'juno-1', // cosmoshub-4 only routes to osmosis-1 in the table
        fromAddress: COSMOS,
        toAddress: addr('juno'),
        denom: 'uatom',
        amount: '1',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/no supported IBC channel from cosmoshub-4 to juno-1/)
  })

  it('rejects a past timeout_timestamp', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        toChainId: 'cosmoshub-4',
        fromAddress: OSMO,
        toAddress: COSMOS,
        denom: 'uosmo',
        amount: '1',
        timeoutTimestamp: '1600000000000000000', // year 2020-ish, < FIXED_NOW
        nowMs: FIXED_NOW,
      })
    ).toThrow(/already in the past/)
  })

  it('requires either sourceChannel or toChainId', () => {
    expect(() =>
      prepareIbcTransfer({
        fromChain: 'osmosis-1',
        fromAddress: OSMO,
        toAddress: COSMOS,
        denom: 'uosmo',
        amount: '1',
        nowMs: FIXED_NOW,
      })
    ).toThrow(/requires either sourceChannel OR toChainId/)
  })

  it('exposes the supported-destinations helper for route discovery', () => {
    const dests = supportedIbcDestinationsFrom('osmosis-1')
    expect(dests).toContain('cosmoshub-4')
    expect(dests).toContain('noble-1')
    expect(dests).toEqual([...dests].sort())
  })
})
