import {
  buildCardanoValue,
  CardanoNativeAsset,
} from './buildCardanoValue'
import { cardanoCborEncoder } from './cborEncoder'

/** CBOR-encode a Cardano `value` — the shape returned by `getBalance()` under CIP-30. */
export const encodeCardanoValue = (
  lovelace: bigint,
  assets: readonly CardanoNativeAsset[]
): Uint8Array =>
  cardanoCborEncoder.encode(buildCardanoValue(lovelace, assets))
