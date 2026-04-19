import { stripHexPrefix } from '@vultisig/lib-utils/hex/stripHexPrefix'

import { CardanoExtendedUtxo } from '../utxo/getCardanoExtendedUtxos'
import { buildCardanoValue } from './buildCardanoValue'
import { cardanoCborEncoder } from './cborEncoder'

const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(stripHexPrefix(hex), 'hex'))

type Input = {
  utxo: CardanoExtendedUtxo
  addressBytes: Uint8Array
}

/**
 * CBOR-encode a CIP-30 `transaction_unspent_output = [input, output]`:
 *
 *     transaction_input  = [ tx_hash: bytes .size 32, index: uint ]
 *     transaction_output = [ address: bytes, amount: value ]
 *
 * `address_bytes` should already be the raw address bytes (see `cardanoAddressBytes`).
 */
export const encodeCardanoUnspentOutput = ({
  utxo,
  addressBytes,
}: Input): Uint8Array =>
  cardanoCborEncoder.encode([
    [hexToBytes(utxo.hash), utxo.index],
    [addressBytes, buildCardanoValue(utxo.amount, utxo.assets)],
  ])
