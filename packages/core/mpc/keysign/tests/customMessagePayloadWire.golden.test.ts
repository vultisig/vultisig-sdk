import { Buffer } from 'buffer'

import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'

import { CustomMessagePayloadSchema } from '../../types/vultisig/keysign/v1/custom_message_payload_pb'
import { KeysignPayloadSchema } from '../../types/vultisig/keysign/v1/keysign_message_pb'

const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const fromHex = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'))

// Produced from the commondata schema with `buf convert`, not by this package,
// so decoding it pins agreement with the Go and Swift generated code.
const commondataWireHex =
  '0a0d706572736f6e616c5f7369676e120c3078343836353663366336661a0530326162632a08457468657265756d32240a0a506f6c796d61726b6574121668747470733a2f2f706f6c796d61726b65742e636f6d'

// The same fixture split at field 6 (tag 0x32, length 0x24).
const fieldsOneToFiveHex =
  '0a0d706572736f6e616c5f7369676e120c3078343836353663366336661a0530326162632a08457468657265756d'
const dappMetadataHex = '0a0a506f6c796d61726b6574121668747470733a2f2f706f6c796d61726b65742e636f6d'

const baseFields = {
  method: 'personal_sign',
  message: '0x48656c6c6f',
  vaultPublicKeyEcdsa: '02abc',
  chain: 'Ethereum',
}

describe('CustomMessagePayload wire format', () => {
  it('round-trips every dApp metadata field', () => {
    const dappMetadata = {
      name: 'Polymarket',
      url: 'https://polymarket.com',
      iconUrl: 'https://polymarket.com/favicon.ico',
    }
    const payload = create(CustomMessagePayloadSchema, { ...baseFields, dappMetadata })

    const decoded = fromBinary(CustomMessagePayloadSchema, toBinary(CustomMessagePayloadSchema, payload))

    expect(decoded).toMatchObject(baseFields)
    expect(decoded.dappMetadata).toMatchObject(dappMetadata)
  })

  it('leaves dApp metadata unset, and the bytes unchanged, when there is no dApp', () => {
    const bytes = toBinary(CustomMessagePayloadSchema, create(CustomMessagePayloadSchema, baseFields))

    expect(toHex(bytes)).toBe(fieldsOneToFiveHex)
    expect(fromBinary(CustomMessagePayloadSchema, bytes).dappMetadata).toBeUndefined()
  })

  it('decodes and re-encodes the commondata fixture byte for byte', () => {
    expect(commondataWireHex).toBe(`${fieldsOneToFiveHex}3224${dappMetadataHex}`)

    const decoded = fromBinary(CustomMessagePayloadSchema, fromHex(commondataWireHex))

    expect(decoded).toMatchObject({ ...baseFields, vaultLocalPartyId: '' })
    expect(decoded.dappMetadata).toMatchObject({
      name: 'Polymarket',
      url: 'https://polymarket.com',
      iconUrl: '',
    })
    expect(toHex(toBinary(CustomMessagePayloadSchema, decoded))).toBe(commondataWireHex)
  })

  it('carries the same metadata bytes on KeysignPayload field 50', () => {
    const bytes = toBinary(
      KeysignPayloadSchema,
      create(KeysignPayloadSchema, { dappMetadata: { name: 'Polymarket', url: 'https://polymarket.com' } })
    )

    // Tag 50 with wire type 2 is the varint 0x92 0x03.
    expect(toHex(bytes)).toBe(`920324${dappMetadataHex}`)
    expect(fromBinary(KeysignPayloadSchema, bytes).dappMetadata).toMatchObject({
      name: 'Polymarket',
      url: 'https://polymarket.com',
      iconUrl: '',
    })
  })
})
