import { Address, beginCell, Cell } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { decodeTonMessageBody, tonPayloadToBase64 } from './decode'
import { TonOp } from './opcodes'

// Real mainnet addresses from knownRouters.ts. Tests pin these so the
// router-binding logic can't silently break by accepting arbitrary destinations.
const STONFI_V2_ROUTER = Address.parse(
  'EQAiLV677BgHNXEUuDJ3Cw8K5WOiJSO86xh8YQq2LthJEoED'
)
const STONFI_V2_PTON_WALLET = Address.parse(
  'EQAmV2BzRi6c-S1263Ar9HhyCLrvtMEae_qfEzhxnK7qSpr0'
)
// DeDust mainnet TON Native Vault. swap#ea06185d is sent here, NOT to the
// factory (verified live via factory.getNativeVault() — see knownRouters.ts).
// The factory at EQBfBWT7… only receives create_vault / create_pool ops.
const DEDUST_NATIVE_VAULT = Address.parse(
  'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_'
)
const DEDUST_FACTORY = Address.parse(
  'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67'
)

const RECIPIENT = Address.parse(
  'EQD__________________________________________0vo'
)
const RESPONSE = Address.parse(
  'EQAvDfWFG0oYX19jwNDNBBL1rKNT9XfaGP9HyTb5nb2Eml6y'
)
const ATTACKER = Address.parseRaw(`0:${'4'.padStart(64, '0')}`)
const POOL = Address.parseRaw(`0:${'1'.padStart(64, '0')}`)
const TOKEN_WALLET = Address.parseRaw(`0:${'2'.padStart(64, '0')}`)
const EXCESSES = Address.parseRaw(`0:${'3'.padStart(64, '0')}`)

const decode = (
  payload: string | null | undefined,
  outerDestination: Address | string | null = RECIPIENT
) =>
  decodeTonMessageBody({
    payload,
    outerDestination:
      outerDestination instanceof Address
        ? outerDestination.toString()
        : outerDestination,
  })

const buildJettonTransferBody = (args: {
  queryId: bigint
  amount: bigint
  destination: Address
  responseDestination: Address | null
  forwardTonAmount: bigint
  forwardPayload?: Cell
}) => {
  const builder = beginCell()
    .storeUint(TonOp.JETTON_TRANSFER, 32)
    .storeUint(args.queryId, 64)
    .storeCoins(args.amount)
    .storeAddress(args.destination)
    .storeAddress(args.responseDestination)
    // custom_payload: Maybe ^Cell — store as absent
    .storeBit(0)
    .storeCoins(args.forwardTonAmount)

  if (args.forwardPayload) {
    builder.storeBit(true).storeRef(args.forwardPayload)
  } else {
    builder.storeBit(false)
  }

  return builder.endCell()
}

const buildNftTransferBody = (args: {
  queryId: bigint
  newOwner: Address
  responseDestination: Address | null
  forwardAmount: bigint
}) =>
  beginCell()
    .storeUint(TonOp.NFT_TRANSFER, 32)
    .storeUint(args.queryId, 64)
    .storeAddress(args.newOwner)
    .storeAddress(args.responseDestination)
    .storeBit(0)
    .storeCoins(args.forwardAmount)
    .storeBit(0)
    .endCell()

const buildExcessesBody = (queryId: bigint) =>
  beginCell()
    .storeUint(TonOp.EXCESSES, 32)
    .storeUint(queryId, 64)
    .endCell()

// STON.fi v2 swap body. Mirrors the encoding produced by
// @ston-fi/sdk@2.x BaseRouterV2_1.createSwapBody — the inner additional_data
// ref carries 8 fields (min_out / receiver / custom_payload_fwd_gas /
// custom_payload / refund_fwd_gas / refund_payload / referral_value /
// referral_address). The decoder consumes them all to fail closed on
// prefix-shaped fakes; tests must produce the full shape.
const buildStonfiSwapPayload = (overrides: {
  truncateAdditionalData?: boolean
} = {}) => {
  const additionalDataBuilder = beginCell()
    .storeCoins(1_147_730_000n) // min_out
    .storeAddress(RECIPIENT) // receiver

  if (overrides.truncateAdditionalData) {
    return beginCell()
      .storeUint(TonOp.STONFI_V2_SWAP, 32)
      .storeAddress(TOKEN_WALLET)
      .storeAddress(RESPONSE)
      .storeAddress(EXCESSES)
      .storeUint(123n, 64)
      .storeRef(additionalDataBuilder.endCell())
      .endCell()
  }

  const additionalData = additionalDataBuilder
    .storeCoins(0n) // custom_payload_fwd_gas
    .storeBit(false) // custom_payload (Maybe ^Cell, absent)
    .storeCoins(0n) // refund_fwd_gas
    .storeBit(false) // refund_payload (Maybe ^Cell, absent)
    .storeUint(10, 16) // referral_value (BPS, 10 = SDK default)
    .storeAddress(null) // referral_address (addr_none — no referral)
    .endCell()

  return beginCell()
    .storeUint(TonOp.STONFI_V2_SWAP, 32)
    .storeAddress(TOKEN_WALLET)
    .storeAddress(RESPONSE)
    .storeAddress(EXCESSES)
    .storeUint(123n, 64)
    .storeRef(additionalData)
    .endCell()
}

const buildStonfiPtonTransferBody = () =>
  beginCell()
    .storeUint(TonOp.PTON_TRANSFER, 32)
    .storeUint(0n, 64)
    .storeCoins(300_000_000n)
    .storeAddress(RESPONSE)
    .storeBit(true)
    .storeRef(buildStonfiSwapPayload())
    .endCell()

const buildDedustNativeSwapBody = () =>
  beginCell()
    .storeUint(TonOp.DEDUST_NATIVE_SWAP, 32)
    .storeUint(777n, 64)
    .storeCoins(500_000_000n)
    .storeAddress(POOL)
    .storeBit(false)
    .storeCoins(42_000n)
    .storeBit(false)
    .storeUint(0, 32)
    .storeAddress(RECIPIENT)
    .storeAddress(null)
    .storeBit(false)
    .storeBit(false)
    .endCell()

describe('decodeTonMessageBody', () => {
  it('returns null for empty input', () => {
    expect(decode(null)).toBeNull()
    expect(decode(undefined)).toBeNull()
    expect(decode('')).toBeNull()
  })

  it('returns null for non-BOC garbage', () => {
    expect(decode('not-a-boc')).toBeNull()
  })

  it('decodes a jetton transfer', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
    }).toBoc().toString('base64')

    expect(decode(body)).toEqual({
      kind: 'jettonTransfer',
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT.toString(),
      responseDestination: RESPONSE.toString(),
      forwardTonAmount: 1_000_000n,
    })
  })

  it('decodes a jetton transfer with no response_destination', () => {
    const body = buildJettonTransferBody({
      queryId: 1n,
      amount: 42n,
      destination: RECIPIENT,
      responseDestination: null,
      forwardTonAmount: 0n,
    }).toBoc().toString('base64')

    const intent = decode(body)

    expect(intent).not.toBeNull()
    if (intent?.kind !== 'jettonTransfer') throw new Error('wrong kind')
    expect(intent.responseDestination).toBeNull()
    expect(intent.forwardTonAmount).toBe(0n)
  })

  it('decodes a STON.fi v2 jetton swap when destination is a known router', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: STONFI_V2_ROUTER,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
      forwardPayload: buildStonfiSwapPayload(),
    })
      .toBoc()
      .toString('base64')

    expect(decode(body)).toEqual({
      kind: 'swap',
      provider: 'stonfi',
      offerAsset: 'jetton',
      offerAmount: 100_000_000n,
      minOut: 1_147_730_000n,
      receiverAddress: RECIPIENT.toString(),
      refundAddress: RESPONSE.toString(),
      excessesAddress: EXCESSES.toString(),
      targetAddress: TOKEN_WALLET.toString(),
    })
  })

  it('does NOT classify a STON.fi-shaped payload sent to an unknown destination as a swap', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: ATTACKER,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
      forwardPayload: buildStonfiSwapPayload(),
    })
      .toBoc()
      .toString('base64')

    const intent = decode(body)
    expect(intent?.kind).toBe('jettonTransfer')
    if (intent?.kind !== 'jettonTransfer') throw new Error('wrong kind')
    expect(intent.destination).toBe(ATTACKER.toString())
  })

  it('decodes a STON.fi v2 pTON transfer swap when outer destination is a known pTON wallet', () => {
    const body = buildStonfiPtonTransferBody().toBoc().toString('base64')

    expect(decode(body, STONFI_V2_PTON_WALLET)).toEqual({
      kind: 'swap',
      provider: 'stonfi',
      offerAsset: 'ton',
      offerAmount: 300_000_000n,
      minOut: 1_147_730_000n,
      receiverAddress: RECIPIENT.toString(),
      refundAddress: RESPONSE.toString(),
      excessesAddress: EXCESSES.toString(),
      targetAddress: TOKEN_WALLET.toString(),
    })
  })

  it('rejects PTON_TRANSFER opcode when outer destination is not a known pTON wallet', () => {
    const body = buildStonfiPtonTransferBody().toBoc().toString('base64')

    expect(decode(body, ATTACKER)).toBeNull()
  })

  it('decodes a DeDust native TON swap when outer destination is the native vault', () => {
    const body = buildDedustNativeSwapBody().toBoc().toString('base64')

    expect(decode(body, DEDUST_NATIVE_VAULT)).toEqual({
      kind: 'swap',
      provider: 'dedust',
      offerAsset: 'ton',
      offerAmount: 500_000_000n,
      minOut: 42_000n,
      receiverAddress: RECIPIENT.toString(),
      refundAddress: null,
      excessesAddress: null,
      targetAddress: POOL.toString(),
    })
  })

  it('rejects DEDUST_NATIVE_SWAP opcode when outer destination is the factory (NOT the vault)', () => {
    // Codex flagged on PR #352 review: the original binding was to the
    // factory, but `swap#ea06185d` is a vault-side op per the DeDust TLB
    // schema (https://docs.dedust.io/reference/tlb-schemes). A real
    // user-signed native swap goes to the native vault; a body addressed
    // to the factory is either a different op (create_vault/create_pool)
    // or an attacker spoof. Either way, must NOT classify as `swap`.
    const body = buildDedustNativeSwapBody().toBoc().toString('base64')

    expect(decode(body, DEDUST_FACTORY)).toBeNull()
  })

  it('rejects DEDUST_NATIVE_SWAP opcode when outer destination is not a known vault', () => {
    const body = buildDedustNativeSwapBody().toBoc().toString('base64')

    expect(decode(body, ATTACKER)).toBeNull()
  })

  it('rejects a DeDust native swap with SwapKind=given_out (kind=1, not implemented)', () => {
    // Per https://docs.dedust.io/reference/tlb-schemes, given_out is not
    // implemented on mainnet. A body that flips the SwapKind bit must fail
    // closed so the keysign UI doesn't surface a swap label for an
    // unsupported encoding (or for a body crafted with garbage in that
    // slot). Codex finding on PR #352 review.
    const body = beginCell()
      .storeUint(TonOp.DEDUST_NATIVE_SWAP, 32)
      .storeUint(777n, 64)
      .storeCoins(500_000_000n)
      .storeAddress(POOL)
      .storeBit(true) // SwapKind=1 (given_out) — invalid
      .storeCoins(42_000n)
      .storeBit(false)
      .storeUint(0, 32)
      .storeAddress(RECIPIENT)
      .storeAddress(null)
      .storeBit(false)
      .storeBit(false)
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body, DEDUST_NATIVE_VAULT)).toBeNull()
  })

  it('rejects a STON.fi v2 swap with truncated additional_data (only min_out + receiver)', () => {
    // Codex flagged on PR #352 review: parseStonfiV2Swap originally read
    // only min_out and receiver, then returned. A body with valid prefix
    // and garbage tail mislabeled as `swap`. Decoder now consumes ALL 8
    // fields of the cross-swap additional_data so prefix-shaped fakes
    // fail closed.
    const body = buildJettonTransferBody({
      queryId: 1n,
      amount: 100n,
      destination: STONFI_V2_ROUTER,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000n,
      forwardPayload: buildStonfiSwapPayload({ truncateAdditionalData: true }),
    })
      .toBoc()
      .toString('base64')

    const intent = decode(body, RECIPIENT)
    // Falls back to plain jetton-transfer classification (router gate
    // still allows the inner classify attempt; the inner parseStonfiV2Swap
    // throws on the missing custom_payload_fwd_gas/etc. Coins read,
    // safeDecode catches it, and the surrounding parseJettonTransfer
    // returns the jettonTransfer result instead).
    expect(intent?.kind).toBe('jettonTransfer')
  })

  it('accepts hex BOC payloads', () => {
    const body = buildStonfiPtonTransferBody().toBoc().toString('hex')

    const intent = decode(body, STONFI_V2_PTON_WALLET)

    expect(intent?.kind).toBe('swap')
    if (intent?.kind !== 'swap') throw new Error('wrong kind')
    expect(intent.offerAmount).toBe(300_000_000n)
  })

  it('decodes an NFT transfer', () => {
    const body = buildNftTransferBody({
      queryId: 99n,
      newOwner: RECIPIENT,
      responseDestination: RESPONSE,
      forwardAmount: 50_000n,
    }).toBoc().toString('base64')

    expect(decode(body)).toEqual({
      kind: 'nftTransfer',
      queryId: 99n,
      newOwner: RECIPIENT.toString(),
      responseDestination: RESPONSE.toString(),
      forwardAmount: 50_000n,
    })
  })

  it('decodes an excesses notification', () => {
    const body = buildExcessesBody(7n).toBoc().toString('base64')
    expect(decode(body)).toEqual({
      kind: 'excesses',
      queryId: 7n,
    })
  })

  it('returns null for an unknown opcode', () => {
    const body = beginCell()
      .storeUint(0xdeadbeef, 32)
      .storeUint(0n, 64)
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toBeNull()
  })

  it('returns null for a body too short to hold an opcode', () => {
    const body = beginCell().storeUint(0, 8).endCell().toBoc().toString('base64')
    expect(decode(body)).toBeNull()
  })

  it('decodes a jetton transfer prefixed with a 0x00000000 text-comment header', () => {
    const inner = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
    })

    const body = beginCell()
      .storeUint(0, 32)
      .storeSlice(inner.beginParse())
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toEqual({
      kind: 'jettonTransfer',
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT.toString(),
      responseDestination: RESPONSE.toString(),
      forwardTonAmount: 1_000_000n,
    })
  })

  it('returns null when jetton transfer body is truncated', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(1n, 64)
      // Missing amount/destination/etc — parseJettonTransfer should reject.
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toBeNull()
  })

  it('returns null when jetton transfer has Either-Cell discriminator set but no ref', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(1n, 64)
      .storeCoins(42n)
      .storeAddress(RECIPIENT)
      .storeAddress(RESPONSE)
      .storeBit(0) // custom_payload absent
      .storeCoins(0n) // forward_ton_amount
      .storeBit(1) // forward_payload says ref — but we never store one
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toBeNull()
  })

  it('returns null when jetton transfer is truncated mid-Either-Cell', () => {
    const body = beginCell()
      .storeUint(TonOp.JETTON_TRANSFER, 32)
      .storeUint(1n, 64)
      .storeCoins(42n)
      .storeAddress(RECIPIENT)
      .storeAddress(RESPONSE)
      .storeBit(0) // custom_payload absent
      .storeCoins(0n) // forward_ton_amount
      // forward_payload discriminator missing entirely
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toBeNull()
  })

  it('returns null when NFT transfer is truncated before forward_payload', () => {
    const body = beginCell()
      .storeUint(TonOp.NFT_TRANSFER, 32)
      .storeUint(1n, 64)
      .storeAddress(RECIPIENT)
      .storeAddress(RESPONSE)
      .storeBit(0) // custom_payload absent
      .storeCoins(0n) // forward_amount
      // forward_payload discriminator missing entirely
      .endCell()
      .toBoc()
      .toString('base64')

    expect(decode(body)).toBeNull()
  })

  it('round-trips hex BOC fixtures through base64 for each magic prefix', () => {
    // The default @ton/core magic (b5ee9c72) is exercised end-to-end against a
    // real BOC payload, including the full decodeTonMessageBody pipeline.
    const realHexBoc = buildExcessesBody(7n).toBoc().toString('hex')
    expect(realHexBoc.slice(0, 8)).toBe('b5ee9c72')
    expect(decode(realHexBoc)).toEqual({ kind: 'excesses', queryId: 7n })

    // For the alternate magics @ton/core does not emit (68ff65f3, acc3a728),
    // verify tonPayloadToBase64 still recognises the input as hex by round-
    // tripping the bytes: hex → base64 → bytes must equal the original hex.
    const tail = '00'.repeat(8)
    for (const magic of ['b5ee9c72', '68ff65f3', 'acc3a728']) {
      const hex = magic + tail
      const base64 = tonPayloadToBase64(hex)
      expect(base64).not.toBe(hex)
      if (base64 === null) throw new Error('expected base64 conversion')
      expect(Buffer.from(base64, 'base64').toString('hex')).toBe(hex)
    }

    // Strings without a known magic prefix must pass through unchanged.
    expect(tonPayloadToBase64('deadbeef' + tail)).toBe('deadbeef' + tail)
  })
})
