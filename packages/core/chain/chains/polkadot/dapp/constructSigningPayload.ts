import { compactToU8a, hexToU8a, u8aConcat } from '@polkadot/util'
import { blake2AsU8a } from '@polkadot/util-crypto'

import { PolkadotSignerPayloadJSON } from './PolkadotSignerPayload'

const polkadotSigningPayloadHashThreshold = 256

/**
 * Construct the raw signing payload bytes from an Asset Hub Polkadot SignerPayloadJSON.
 *
 * SCOPE: Asset Hub (statemint/statemine) payloads ONLY. The payload must include
 * both `ChargeAssetTxPayment` and `CheckMetadataHash` in `signedExtensions`.
 * Relay-chain payloads use different extensions and must NOT use this function.
 *
 * Follows the Asset Hub Polkadot (statemint) extrinsic payload v4 encoding:
 * method + era + compact(nonce) + compact(tip)
 * + ChargeAssetTxPayment::extra (Option<MultiLocation>=None = 0x00)
 * + CheckMetadataHash::extra (mode=Disabled = 0x00)
 * + LE-u32(specVersion) + LE-u32(transactionVersion)
 * + genesisHash + blockHash
 * + CheckMetadataHash::additional_signed (Option<H256>=None = 0x00)
 *
 * The three Asset Hub signed-extension bytes (ChargeAssetTxPayment option byte,
 * CheckMetadataHash mode byte, CheckMetadataHash additional-signed byte) are
 * required by the Asset Hub runtime. Without them the node rejects the
 * extrinsic with BadProof because the payload hash the node computes differs
 * from the one the wallet signed.
 *
 * If the payload exceeds 256 bytes, it is blake2b-256 hashed before signing.
 */
export const constructAssetHubPolkadotSigningPayload = (payload: PolkadotSignerPayloadJSON): Uint8Array => {
  const required = ['ChargeAssetTxPayment', 'CheckMetadataHash']
  if (payload.signedExtensions && payload.signedExtensions.length > 0) {
    const missing = required.filter(ext => !payload.signedExtensions!.includes(ext))
    if (missing.length > 0) {
      throw new Error(
        `constructAssetHubPolkadotSigningPayload: payload signedExtensions missing required Asset Hub extensions: ${missing.join(', ')}. This function only encodes Asset Hub (statemint) payloads.`
      )
    }
  }
  const method = hexToU8a(payload.method)
  const era = hexToU8a(payload.era)
  const nonce = compactToU8a(parseInt(payload.nonce, 16))
  const tip = compactToU8a(payload.tip ? BigInt(payload.tip) : 0n)

  // ChargeAssetTxPayment::extra - Option<MultiLocation> = None
  const chargeAssetTxPaymentNone = new Uint8Array([0x00])
  // CheckMetadataHash::extra - mode byte = Disabled
  const checkMetadataHashMode = new Uint8Array([0x00])

  const specVersion = new Uint8Array(4)
  new DataView(specVersion.buffer).setUint32(0, parseInt(payload.specVersion, 16), true)

  const transactionVersion = new Uint8Array(4)
  new DataView(transactionVersion.buffer).setUint32(0, parseInt(payload.transactionVersion, 16), true)

  const genesisHash = hexToU8a(payload.genesisHash)
  const blockHash = hexToU8a(payload.blockHash)

  // CheckMetadataHash::additional_signed - Option<H256> = None
  const checkMetadataHashNone = new Uint8Array([0x00])

  const raw = u8aConcat(
    method,
    era,
    nonce,
    tip,
    chargeAssetTxPaymentNone,
    checkMetadataHashMode,
    specVersion,
    transactionVersion,
    genesisHash,
    blockHash,
    checkMetadataHashNone
  )

  if (raw.length > polkadotSigningPayloadHashThreshold) {
    return blake2AsU8a(raw, 256)
  }

  return raw
}
