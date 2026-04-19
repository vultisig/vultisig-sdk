import { fromBech32 } from '@cosmjs/encoding'

/**
 * Cardano base/stake addresses exceed the BIP173 90-char bech32 limit.
 * Their raw byte length tops out at 57 bytes, so 200 is a comfortable cap.
 */
const cardanoBech32Limit = 200

/**
 * Decode a Cardano bech32 address into its raw byte representation.
 * CIP-30 addresses cross the dApp boundary as hex of these bytes.
 */
export const cardanoAddressBytes = (bech32Address: string): Uint8Array =>
  fromBech32(bech32Address, cardanoBech32Limit).data
