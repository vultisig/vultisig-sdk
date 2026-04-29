import { Address, beginCell, Cell } from '@ton/core'
import { describe, expect, it } from 'vitest'

import { decodeTonMessageBody, tonPayloadToBase64 } from './decode'
import { TonOp } from './opcodes'

const RECIPIENT = Address.parse(
  'EQD__________________________________________0vo'
)
const RESPONSE = Address.parse(
  'EQAvDfWFG0oYX19jwNDNBBL1rKNT9XfaGP9HyTb5nb2Eml6y'
)
const POOL = Address.parseRaw(`0:${'1'.padStart(64, '0')}`)
const TOKEN_WALLET = Address.parseRaw(`0:${'2'.padStart(64, '0')}`)
const EXCESSES = Address.parseRaw(`0:${'3'.padStart(64, '0')}`)

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

const buildStonfiSwapPayload = () => {
  const additionalData = beginCell()
    .storeCoins(1_147_730_000n)
    .storeAddress(RECIPIENT)
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

const buildDedustJettonSwapPayload = () =>
  beginCell()
    .storeUint(TonOp.DEDUST_JETTON_SWAP, 32)
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
    expect(decodeTonMessageBody(null)).toBeNull()
    expect(decodeTonMessageBody(undefined)).toBeNull()
    expect(decodeTonMessageBody('')).toBeNull()
  })

  it('returns null for non-BOC garbage', () => {
    expect(decodeTonMessageBody('not-a-boc')).toBeNull()
  })

  it('decodes a jetton transfer', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
    }).toBoc().toString('base64')

    const intent = decodeTonMessageBody(body)

    expect(intent).toEqual({
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

    const intent = decodeTonMessageBody(body)

    expect(intent).not.toBeNull()
    if (intent?.kind !== 'jettonTransfer') throw new Error('wrong kind')
    expect(intent.responseDestination).toBeNull()
    expect(intent.forwardTonAmount).toBe(0n)
  })

  it('decodes a STON.fi v2 jetton swap transfer', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
      forwardPayload: buildStonfiSwapPayload(),
    })
      .toBoc()
      .toString('base64')

    expect(decodeTonMessageBody(body)).toEqual({
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

  it('decodes a STON.fi v2 pTON transfer swap', () => {
    const body = buildStonfiPtonTransferBody().toBoc().toString('base64')

    expect(decodeTonMessageBody(body)).toEqual({
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

  it('decodes a DeDust jetton swap transfer', () => {
    const body = buildJettonTransferBody({
      queryId: 12345n,
      amount: 100_000_000n,
      destination: RECIPIENT,
      responseDestination: RESPONSE,
      forwardTonAmount: 1_000_000n,
      forwardPayload: buildDedustJettonSwapPayload(),
    })
      .toBoc()
      .toString('base64')

    expect(decodeTonMessageBody(body)).toEqual({
      kind: 'swap',
      provider: 'dedust',
      offerAsset: 'jetton',
      offerAmount: 100_000_000n,
      minOut: 42_000n,
      receiverAddress: RECIPIENT.toString(),
      refundAddress: null,
      excessesAddress: null,
      targetAddress: POOL.toString(),
    })
  })

  it('decodes a DeDust native TON swap', () => {
    const body = buildDedustNativeSwapBody().toBoc().toString('base64')

    expect(decodeTonMessageBody(body)).toEqual({
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

  it('accepts hex BOC payloads', () => {
    const body = buildStonfiPtonTransferBody().toBoc().toString('hex')

    const intent = decodeTonMessageBody(body)

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

    const intent = decodeTonMessageBody(body)

    expect(intent).toEqual({
      kind: 'nftTransfer',
      queryId: 99n,
      newOwner: RECIPIENT.toString(),
      responseDestination: RESPONSE.toString(),
      forwardAmount: 50_000n,
    })
  })

  it('decodes an excesses notification', () => {
    const body = buildExcessesBody(7n).toBoc().toString('base64')
    expect(decodeTonMessageBody(body)).toEqual({
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

    expect(decodeTonMessageBody(body)).toBeNull()
  })

  it('returns null for a body too short to hold an opcode', () => {
    const body = beginCell().storeUint(0, 8).endCell().toBoc().toString('base64')
    expect(decodeTonMessageBody(body)).toBeNull()
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

    expect(decodeTonMessageBody(body)).toEqual({
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

    expect(decodeTonMessageBody(body)).toBeNull()
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

    expect(decodeTonMessageBody(body)).toBeNull()
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

    expect(decodeTonMessageBody(body)).toBeNull()
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

    expect(decodeTonMessageBody(body)).toBeNull()
  })

  it('treats hex strings with each TON BOC magic prefix as hex', () => {
    // tonPayloadToBase64 returns a base64-converted string when the input is a
    // valid hex BOC, otherwise it passes the input through unchanged. The
    // helper is exercised here to confirm all three @ton/core magic prefixes
    // are recognised, not just b5ee9c72.
    const tail = '00'.repeat(8)
    expect(tonPayloadToBase64('b5ee9c72' + tail)).not.toBe('b5ee9c72' + tail)
    expect(tonPayloadToBase64('68ff65f3' + tail)).not.toBe('68ff65f3' + tail)
    expect(tonPayloadToBase64('acc3a728' + tail)).not.toBe('acc3a728' + tail)
    expect(tonPayloadToBase64('deadbeef' + tail)).toBe('deadbeef' + tail)
  })
})
